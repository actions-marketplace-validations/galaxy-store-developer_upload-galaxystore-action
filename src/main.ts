import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppStatus, GalaxyStoreClient } from './galaxyStoreClient';

const CONTENT_ID_PATTERN = /^\d{12}$/;
const PUBLICATION_TYPES = ['01', '02', '03'];
const PUBLICATION_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const MODES = ['upload', 'update-rollout'] as const;
const APP_STATUSES: AppStatus[] = ['SALE', 'REGISTRATION'];

type Mode = (typeof MODES)[number];

// Thrown for invalid inputs; run() reports the message via core.setFailed
class InputError extends Error {}

// Validates yyyy-MM-dd HH:mm:ss and rejects impossible dates such as 2026-13-45 99:99:99
export function isValidPublicationDate(value: string): boolean {
  const match = PUBLICATION_DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// The add-binary endpoint returns binarySeq as a string (e.g. "3"); accept string or number
export function parseBinarySeq(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

// rollout-rate must be an integer from 1 to 100
function parseRolloutRate(input: string): number {
  const isInteger = /^\d+$/.test(input);
  const rate = isInteger ? Number(input) : NaN;
  if (!isInteger || rate < 1 || rate > 100) {
    throw new InputError(`rollout-rate must be an integer between 1 and 100, got: '${input}'`);
  }
  return rate;
}

// Main entry point for the GitHub Action. Reads inputs, validates, and dispatches on mode.
export async function run(): Promise<void> {
  try {
    const accessToken = core.getInput('access-token', { required: true });
    core.setSecret(accessToken);
    const serviceAccountId = core.getInput('service-account-id', { required: true });
    const contentId = core.getInput('content-id', { required: true });
    const mode = (core.getInput('mode') || 'upload') as Mode;

    if (!CONTENT_ID_PATTERN.test(contentId)) {
      throw new InputError(`content-id must be a 12-digit number, got: '${contentId}'`);
    }
    if (!MODES.includes(mode)) {
      throw new InputError(`mode must be one of ${MODES.join(', ')}, got: '${mode}'`);
    }

    const client = new GalaxyStoreClient(serviceAccountId, accessToken);

    if (mode === 'update-rollout') {
      await runUpdateRollout(client, contentId);
    } else {
      await runUpload(client, contentId);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

// mode: update-rollout — raise the staged rollout rate of an existing SALE or REGISTRATION version.
// No file is uploaded and no update session is opened.
async function runUpdateRollout(client: GalaxyStoreClient, contentId: string): Promise<void> {
  const appStatus = core.getInput('rollout-app-status') as AppStatus;
  const rolloutRateInput = core.getInput('rollout-rate');

  if (!APP_STATUSES.includes(appStatus)) {
    throw new InputError(`rollout-app-status must be SALE or REGISTRATION when mode is update-rollout, got: '${appStatus}'`);
  }
  const rolloutRate = parseRolloutRate(rolloutRateInput);

  core.info(`Reading current staged rollout rate for the ${appStatus} version of content ID ${contentId}...`);
  const current = await client.getStagedRolloutRate(contentId, appStatus);
  if (current === null || current.rolloutRate === undefined) {
    throw new Error(
      `No staged rollout exists on the ${appStatus} version of content ID ${contentId}. ` +
      'update-rollout can only change an existing rollout; use mode: upload with staged-rollout: true to start one.'
    );
  }

  core.info(`Current rollout rate: ${current.rolloutRate}%`);
  core.setOutput('previous-rollout-rate', String(current.rolloutRate));

  if (rolloutRate <= current.rolloutRate) {
    throw new Error(
      `rollout-rate must be higher than the current rate of ${current.rolloutRate}%, got: ${rolloutRate}%`
    );
  }

  core.info(`Setting staged rollout rate on the ${appStatus} version to ${rolloutRate}%...`);
  await client.setStagedRolloutRate(contentId, rolloutRate, appStatus);
  core.info('Staged rollout rate updated successfully');
}

// mode: upload — open an update, upload the binary, register it, and optionally stage/submit it.
async function runUpload(client: GalaxyStoreClient, contentId: string): Promise<void> {
  const packagePath = core.getInput('package-path', { required: true });
  const binarySeqForDeviceInfo = core.getInput('binary-seq-for-device-info') || undefined;
  const submit = core.getBooleanInput('submit');
  const stagedRollout = core.getBooleanInput('staged-rollout');
  const disableExistingRollout = core.getBooleanInput('disable-existing-rollout');
  const rolloutRateInput = core.getInput('rollout-rate');
  const publicationType = core.getInput('publication-type') || '01';
  const startPublicationDate = core.getInput('start-publication-date') || undefined;

  if (!fs.existsSync(packagePath)) {
    throw new InputError(`File not found at path: ${packagePath}`);
  }

  const ext = path.extname(packagePath).toLowerCase();
  if (!['.apk', '.aab'].includes(ext)) {
    throw new InputError(`Unsupported file type '${ext}'. Must be .apk or .aab`);
  }

  // rollout-rate is only meaningful (and only validated) when staged rollout is enabled
  let rolloutRate = 0;
  if (stagedRollout) {
    try {
      rolloutRate = parseRolloutRate(rolloutRateInput);
    } catch (error) {
      throw new InputError(`${(error as Error).message} (required when staged-rollout is enabled)`);
    }
  }

  if (!PUBLICATION_TYPES.includes(publicationType)) {
    throw new InputError(`publication-type must be 01, 02, or 03, got: '${publicationType}'`);
  }

  if (publicationType === '02' && !startPublicationDate) {
    throw new InputError('start-publication-date is required when publication-type is 02');
  }

  if (startPublicationDate && !isValidPublicationDate(startPublicationDate)) {
    throw new InputError(`start-publication-date must be a valid date in yyyy-MM-dd HH:mm:ss format, got: '${startPublicationDate}'`);
  }

  // Step 0 (optional): Samsung requires an existing live staged rollout to be disabled (or at 100%)
  // before a new one can be enabled on the update. This changes the live app, so it is opt-in.
  if (stagedRollout && disableExistingRollout) {
    core.info('Checking for an existing staged rollout on the live (SALE) version...');
    const existing = await client.getStagedRolloutRate(contentId, 'SALE');
    if (existing === null || existing.rolloutRate === undefined) {
      core.info('No existing staged rollout found on the live version');
    } else if (existing.rolloutRate >= 100) {
      core.info(`Existing staged rollout is already at ${existing.rolloutRate}%, nothing to disable`);
    } else {
      core.info(`Disabling existing staged rollout on the live version (currently ${existing.rolloutRate}%)...`);
      await client.disableStagedRollout(contentId, 'SALE');
      core.info('Existing staged rollout disabled');
    }
  }

  // Step 1: Open an update session for the app
  core.info(`Creating app update for content ID ${contentId}...`);
  await client.createUpdate(contentId, publicationType, startPublicationDate);

  // Snapshot existing binaries before upload. Only needed as a fallback if the add-binary
  // response does not include the new binarySeq (API releases before 2026.05.13).
  let binariesBefore: Set<number> | undefined;
  if (stagedRollout) {
    core.info('Fetching staged rollout binaries (REGISTRATION)...');
    let before = await client.getStagedRolloutBinaries(contentId, 'REGISTRATION');
    if (before.length === 0) {
      core.info('No REGISTRATION binaries found, fetching SALE binaries as baseline...');
      before = await client.getStagedRolloutBinaries(contentId, 'SALE');
    }
    core.info(`Baseline binaries (seqs: ${before.map(b => b.seq).join(', ') || 'none'})`);
    binariesBefore = new Set(before.map(b => b.seq));
  }

  // Step 2: Upload the binary file and get a fileKey
  core.info(`Uploading ${path.basename(packagePath)}...`);
  const uploadResult = await client.uploadFile(packagePath);
  const fileKey = uploadResult.fileKey;
  core.info(`File uploaded successfully, file key: ${fileKey}`);

  // Step 3: Register the uploaded binary against the content ID
  core.info(`Adding binary to content ID ${contentId}...`);
  const result = await client.addBinary(contentId, fileKey, binarySeqForDeviceInfo);
  core.info('Binary added successfully');

  core.setOutput('upload-result', JSON.stringify(result));

  // Step 4 (optional): Add binary to staged rollout and set rollout rate
  if (stagedRollout) {
    let binarySeq = parseBinarySeq(result?.data?.binarySeq);
    if (binarySeq !== undefined) {
      core.info(`New binary seq ${binarySeq} (from add-binary response)`);
    } else {
      core.info('Add-binary response did not include binarySeq, fetching staged rollout binaries after upload (REGISTRATION)...');
      const after = await client.getStagedRolloutBinaries(contentId, 'REGISTRATION');
      core.info(`Post-upload binaries (seqs: ${after.map(b => b.seq).join(', ') || 'none'})`);
      const newSeqs = after.map(b => b.seq).filter(seq => !binariesBefore!.has(seq));

      if (newSeqs.length === 0) {
        throw new Error('Could not determine the new binary sequence for staged rollout: no new binaries found after upload');
      }
      if (newSeqs.length > 1) {
        core.warning(`Multiple new binaries detected (seqs: ${newSeqs.join(', ')}). Using the highest one.`);
      }
      binarySeq = Math.max(...newSeqs);
      core.info(`New binary seq ${binarySeq} (from staged rollout diff)`);
    }

    // Expose the seq as early as possible so callers can act on it even if a later step fails
    core.setOutput('binary-seq', String(binarySeq));

    core.info(`Adding binary seq ${binarySeq} to staged rollout...`);
    await client.addStagedRolloutBinary(contentId, binarySeq);
    core.info('Binary added to staged rollout successfully');

    core.info(`Setting staged rollout rate to ${rolloutRate}%...`);
    await client.setStagedRolloutRate(contentId, rolloutRate, 'REGISTRATION');
    core.info('Staged rollout rate set successfully');
  }

  // Step 5 (optional): Submit the app for review
  if (submit) {
    core.info('Submitting app for review...');
    await client.submitApp(contentId);
    core.info('App submitted successfully');
  }
}

/* istanbul ignore next */
if (!process.env.JEST_WORKER_ID) {
  run();
}

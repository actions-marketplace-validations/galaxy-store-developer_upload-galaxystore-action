import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { GalaxyStoreClient } from './galaxyStoreClient';

const CONTENT_ID_PATTERN = /^\d{12}$/;
const PUBLICATION_TYPES = ['01', '02', '03'];
const PUBLICATION_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

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

// Main entry point for the GitHub Action. Reads inputs, validates, and orchestrates the upload flow.
export async function run(): Promise<void> {
  try {
    // Read action inputs
    const accessToken = core.getInput('access-token', { required: true });
    core.setSecret(accessToken);
    const serviceAccountId = core.getInput('service-account-id', { required: true });
    const contentId = core.getInput('content-id', { required: true });
    const packagePath = core.getInput('package-path', { required: true });
    const binarySeqForDeviceInfo = core.getInput('binary-seq-for-device-info') || undefined;
    const submit = core.getBooleanInput('submit');
    const stagedRollout = core.getBooleanInput('staged-rollout');
    const disableExistingRollout = core.getBooleanInput('disable-existing-rollout');
    const rolloutRateInput = core.getInput('rollout-rate');
    const publicationType = core.getInput('publication-type') || '01';
    const startPublicationDate = core.getInput('start-publication-date') || undefined;

    if (!CONTENT_ID_PATTERN.test(contentId)) {
      core.setFailed(`content-id must be a 12-digit number, got: '${contentId}'`);
      return;
    }

    if (!fs.existsSync(packagePath)) {
      core.setFailed(`File not found at path: ${packagePath}`);
      return;
    }

    const ext = path.extname(packagePath).toLowerCase();
    if (!['.apk', '.aab'].includes(ext)) {
      core.setFailed(`Unsupported file type '${ext}'. Must be .apk or .aab`);
      return;
    }

    // rollout-rate is only meaningful (and only validated) when staged rollout is enabled
    let rolloutRate = 0;
    if (stagedRollout) {
      const isInteger = /^\d+$/.test(rolloutRateInput);
      rolloutRate = isInteger ? Number(rolloutRateInput) : NaN;
      if (!isInteger || rolloutRate < 1 || rolloutRate > 100) {
        core.setFailed(`rollout-rate must be an integer between 1 and 100 when staged-rollout is enabled, got: '${rolloutRateInput}'`);
        return;
      }
    }

    if (!PUBLICATION_TYPES.includes(publicationType)) {
      core.setFailed(`publication-type must be 01, 02, or 03, got: '${publicationType}'`);
      return;
    }

    if (publicationType === '02' && !startPublicationDate) {
      core.setFailed('start-publication-date is required when publication-type is 02');
      return;
    }

    if (startPublicationDate && !isValidPublicationDate(startPublicationDate)) {
      core.setFailed(`start-publication-date must be a valid date in yyyy-MM-dd HH:mm:ss format, got: '${startPublicationDate}'`);
      return;
    }

    const client = new GalaxyStoreClient(serviceAccountId, accessToken);

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
      await client.setStagedRolloutRate(contentId, rolloutRate);
      core.info('Staged rollout rate set successfully');
    }

    // Step 5 (optional): Submit the app for review
    if (submit) {
      core.info('Submitting app for review...');
      await client.submitApp(contentId);
      core.info('App submitted successfully');
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

/* istanbul ignore next */
if (!process.env.JEST_WORKER_ID) {
  run();
}

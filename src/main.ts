import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { GalaxyStoreClient } from './galaxyStoreClient';

async function run(): Promise<void> {
  try {
    const accessToken = core.getInput('access-token', { required: true });
    const serviceAccountId = core.getInput('service-account-id', { required: true });
    const contentId = core.getInput('content-id', { required: true });
    const packagePath = core.getInput('package-path', { required: true });
    const binarySeqForDeviceInfo = core.getInput('binary-seq-for-device-info') || undefined;
    const submit = core.getBooleanInput('submit');
    const stagedRollout = core.getBooleanInput('staged-rollout');
    const rolloutRate = parseInt(core.getInput('rollout-rate') || '0', 10);
    const publicationType = core.getInput('publication-type') || '01';
    const startPublicationDate = core.getInput('start-publication-date') || undefined;

    if (!/^\d{12}$/.test(contentId)) {
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

    if (stagedRollout && (rolloutRate < 0 || rolloutRate > 100)) {
      core.setFailed(`rollout-rate must be between 0 and 100 when staged-rollout is enabled, got: ${rolloutRate}`);
      return;
    }

    if (!['01', '02', '03'].includes(publicationType)) {
      core.setFailed(`publication-type must be 01, 02, or 03, got: '${publicationType}'`);
      return;
    }

    if (publicationType === '02' && !startPublicationDate) {
      core.setFailed('start-publication-date is required when publication-type is 02');
      return;
    }

    if (startPublicationDate && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(startPublicationDate)) {
      core.setFailed(`start-publication-date must be in yyyy-MM-dd HH:mm:ss format, got: '${startPublicationDate}'`);
      return;
    }

    const client = new GalaxyStoreClient(serviceAccountId, accessToken);

    core.info(`Creating app update for content ID ${contentId}...`);
    await client.createUpdate(contentId, publicationType, startPublicationDate);

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

    core.info(`Uploading ${path.basename(packagePath)}...`);
    const uploadResult = await client.uploadFile(packagePath);
    const fileKey = uploadResult.fileKey;
    core.info(`File uploaded successfully, file key: ${fileKey}`);

    core.info(`Adding binary to content ID ${contentId}...`);
    const result = await client.addBinary(contentId, fileKey, binarySeqForDeviceInfo);
    core.info('Binary added successfully');

    core.setOutput('upload-result', JSON.stringify(result));

    if (stagedRollout) {
      core.info('Fetching staged rollout binaries after upload (REGISTRATION)...');
      const after = await client.getStagedRolloutBinaries(contentId, 'REGISTRATION');
      core.info(`Post-upload binaries (seqs: ${after.map(b => b.seq).join(', ') || 'none'})`);
      const newBinaries = after.filter(b => !binariesBefore!.has(b.seq));

      if (newBinaries.length === 0) {
        throw new Error('Could not determine the new binary sequence for staged rollout: no new binaries found after upload');
      }
      if (newBinaries.length > 1) {
        core.warning(`Multiple new binaries detected (seqs: ${newBinaries.map(b => b.seq).join(', ')}). Using the last one.`);
      }

      const binarySeq = newBinaries[newBinaries.length - 1].seq;
      core.info(`Adding binary seq ${binarySeq} to staged rollout...`);
      await client.addStagedRolloutBinary(contentId, binarySeq);
      core.info('Binary added to staged rollout successfully');

      core.info(`Setting staged rollout rate to ${rolloutRate}%...`);
      await client.setStagedRolloutRate(contentId, rolloutRate);
      core.info('Staged rollout rate set successfully');

      core.setOutput('binary-seq', String(binarySeq));
    }

    if (submit) {
      core.info(`Submitting app for review...`);
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

run();

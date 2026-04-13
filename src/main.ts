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

    const client = new GalaxyStoreClient(serviceAccountId, accessToken);

    core.info(`Creating app update for content ID ${contentId}...`);
    await client.createUpdate(contentId);

    core.info(`Uploading ${path.basename(packagePath)}...`);
    const uploadResult = await client.uploadFile(packagePath);
    const fileKey = uploadResult.fileKey;
    core.info(`File uploaded successfully, file key: ${fileKey}`);

    core.info(`Adding binary to content ID ${contentId}...`);
    const result = await client.addBinary(contentId, fileKey);
    core.info('Binary added successfully');

    core.setOutput('upload-result', JSON.stringify(result));
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

run();

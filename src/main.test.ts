const mockCreateUpdate = jest.fn();
const mockUploadFile = jest.fn();
const mockAddBinary = jest.fn();
const mockSubmitApp = jest.fn();
const mockGetStagedRolloutBinaries = jest.fn();
const mockAddStagedRolloutBinary = jest.fn();
const mockSetStagedRolloutRate = jest.fn();

jest.mock('./galaxyStoreClient', () => ({
  GalaxyStoreClient: jest.fn().mockImplementation(() => ({
    createUpdate: mockCreateUpdate,
    uploadFile: mockUploadFile,
    addBinary: mockAddBinary,
    submitApp: mockSubmitApp,
    getStagedRolloutBinaries: mockGetStagedRolloutBinaries,
    addStagedRolloutBinary: mockAddStagedRolloutBinary,
    setStagedRolloutRate: mockSetStagedRolloutRate
  }))
}));

jest.mock('@actions/core');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn()
}));

import * as core from '@actions/core';
import * as fs from 'fs';
import { run } from './main';

const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>;
const mockGetBooleanInput = core.getBooleanInput as jest.MockedFunction<typeof core.getBooleanInput>;
const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>;
const mockSetOutput = core.setOutput as jest.MockedFunction<typeof core.setOutput>;
const mockInfo = core.info as jest.MockedFunction<typeof core.info>;
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

function setupInputs(
  overrides: Record<string, string> = {},
  booleans: Record<string, boolean> = {}
) {
  const inputs: Record<string, string> = {
    'access-token': 'test-token',
    'service-account-id': 'test-account',
    'content-id': '000012345678',
    'package-path': './test.aab',
    'binary-seq-for-device-info': '',
    'rollout-rate': '0',
    'publication-type': '01',
    'start-publication-date': '',
    ...overrides
  };
  const bools: Record<string, boolean> = {
    'submit': false,
    'staged-rollout': false,
    ...booleans
  };
  mockGetInput.mockImplementation((name: string) => inputs[name] ?? '');
  mockGetBooleanInput.mockImplementation((name: string) => bools[name] ?? false);
  mockExistsSync.mockReturnValue(true);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUploadFile.mockResolvedValue({ fileKey: 'test-file-key' });
  mockAddBinary.mockResolvedValue({ success: true });
  mockCreateUpdate.mockResolvedValue(undefined);
  mockSubmitApp.mockResolvedValue({ success: true });
  mockGetStagedRolloutBinaries.mockResolvedValue([]);
  mockAddStagedRolloutBinary.mockResolvedValue({ success: true });
  mockSetStagedRolloutRate.mockResolvedValue({ success: true });
});

describe('input validation', () => {
  test('fails if content-id is not 12 digits', async () => {
    setupInputs({ 'content-id': '12345' });
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('content-id must be a 12-digit number')
    );
  });

  test('fails if file does not exist', async () => {
    setupInputs();
    mockExistsSync.mockReturnValue(false);
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('File not found')
    );
  });

  test('fails if file extension is unsupported', async () => {
    setupInputs({ 'package-path': './test.zip' });
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Unsupported file type")
    );
  });

  test('fails if rollout-rate > 100 when staged-rollout is true', async () => {
    setupInputs({ 'rollout-rate': '150' }, { 'staged-rollout': true });
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('rollout-rate must be between 0 and 100')
    );
  });

  test('fails if rollout-rate < 0 when staged-rollout is true', async () => {
    setupInputs({ 'rollout-rate': '-5' }, { 'staged-rollout': true });
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('rollout-rate must be between 0 and 100')
    );
  });

  test('fails if publication-type is invalid', async () => {
    setupInputs({ 'publication-type': '04' });
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('publication-type must be 01, 02, or 03')
    );
  });

  test('fails if publication-type is 02 without start-publication-date', async () => {
    setupInputs({ 'publication-type': '02' });
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('start-publication-date is required')
    );
  });

  test('fails if start-publication-date has wrong format', async () => {
    setupInputs({ 'publication-type': '02', 'start-publication-date': '2026/06/01' });
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('start-publication-date must be in yyyy-MM-dd HH:mm:ss format')
    );
  });

  test('accepts valid start-publication-date format', async () => {
    setupInputs({ 'publication-type': '02', 'start-publication-date': '2026-06-01 09:00:00' });
    await run();
    expect(mockSetFailed).not.toHaveBeenCalled();
  });
});

describe('upload flow', () => {
  test('calls createUpdate, uploadFile, and addBinary', async () => {
    setupInputs();
    await run();
    expect(mockCreateUpdate).toHaveBeenCalledWith('000012345678', '01', undefined);
    expect(mockUploadFile).toHaveBeenCalledWith('./test.aab');
    expect(mockAddBinary).toHaveBeenCalledWith('000012345678', 'test-file-key', undefined);
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  test('passes publicationType and startPublicationDate to createUpdate', async () => {
    setupInputs({ 'publication-type': '02', 'start-publication-date': '2026-06-01 09:00:00' });
    await run();
    expect(mockCreateUpdate).toHaveBeenCalledWith('000012345678', '02', '2026-06-01 09:00:00');
  });

  test('submits app when submit is true', async () => {
    setupInputs({}, { 'submit': true });
    await run();
    expect(mockSubmitApp).toHaveBeenCalledWith('000012345678');
  });

  test('does not submit when submit is false', async () => {
    setupInputs({}, { 'submit': false });
    await run();
    expect(mockSubmitApp).not.toHaveBeenCalled();
  });

  test('sets upload-result output', async () => {
    setupInputs();
    await run();
    expect(mockSetOutput).toHaveBeenCalledWith('upload-result', JSON.stringify({ success: true }));
  });
});

describe('staged rollout', () => {
  test('diffs before/after binaries to find new seq', async () => {
    setupInputs({ 'rollout-rate': '10' }, { 'staged-rollout': true });
    mockGetStagedRolloutBinaries
      .mockResolvedValueOnce([{ seq: 1 }]) // REGISTRATION before
      .mockResolvedValueOnce([{ seq: 1 }, { seq: 2 }]); // REGISTRATION after

    await run();

    expect(mockAddStagedRolloutBinary).toHaveBeenCalledWith('000012345678', 2);
    expect(mockSetStagedRolloutRate).toHaveBeenCalledWith('000012345678', 10);
    expect(mockSetOutput).toHaveBeenCalledWith('binary-seq', '2');
  });

  test('falls back to SALE binaries when REGISTRATION is empty', async () => {
    setupInputs({ 'rollout-rate': '25' }, { 'staged-rollout': true });
    mockGetStagedRolloutBinaries
      .mockResolvedValueOnce([]) // REGISTRATION before — empty
      .mockResolvedValueOnce([{ seq: 1 }]) // SALE before
      .mockResolvedValueOnce([{ seq: 1 }, { seq: 3 }]); // REGISTRATION after

    await run();

    expect(mockGetStagedRolloutBinaries).toHaveBeenCalledWith('000012345678', 'REGISTRATION');
    expect(mockGetStagedRolloutBinaries).toHaveBeenCalledWith('000012345678', 'SALE');
    expect(mockAddStagedRolloutBinary).toHaveBeenCalledWith('000012345678', 3);
    expect(mockSetStagedRolloutRate).toHaveBeenCalledWith('000012345678', 25);
  });

  test('fails if no new binaries found after upload', async () => {
    setupInputs({ 'rollout-rate': '10' }, { 'staged-rollout': true });
    mockGetStagedRolloutBinaries
      .mockResolvedValueOnce([{ seq: 1 }])
      .mockResolvedValueOnce([{ seq: 1 }]); // same as before

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('no new binaries found after upload')
    );
  });

  test('warns but uses last when multiple new binaries found', async () => {
    setupInputs({ 'rollout-rate': '10' }, { 'staged-rollout': true });
    mockGetStagedRolloutBinaries
      .mockResolvedValueOnce([{ seq: 1 }])
      .mockResolvedValueOnce([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);

    await run();

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('Multiple new binaries detected')
    );
    expect(mockAddStagedRolloutBinary).toHaveBeenCalledWith('000012345678', 3);
  });

  test('does not run staged rollout when disabled', async () => {
    setupInputs({}, { 'staged-rollout': false });
    await run();
    expect(mockGetStagedRolloutBinaries).not.toHaveBeenCalled();
    expect(mockAddStagedRolloutBinary).not.toHaveBeenCalled();
  });
});

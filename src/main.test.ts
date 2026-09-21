const mockCreateUpdate = jest.fn();
const mockUploadFile = jest.fn();
const mockAddBinary = jest.fn();
const mockSubmitApp = jest.fn();
const mockGetStagedRolloutBinaries = jest.fn();
const mockAddStagedRolloutBinary = jest.fn();
const mockSetStagedRolloutRate = jest.fn();
const mockGetStagedRolloutRate = jest.fn();
const mockDisableStagedRollout = jest.fn();

jest.mock('./galaxyStoreClient', () => ({
  GalaxyStoreClient: jest.fn().mockImplementation(() => ({
    createUpdate: mockCreateUpdate,
    uploadFile: mockUploadFile,
    addBinary: mockAddBinary,
    submitApp: mockSubmitApp,
    getStagedRolloutBinaries: mockGetStagedRolloutBinaries,
    addStagedRolloutBinary: mockAddStagedRolloutBinary,
    setStagedRolloutRate: mockSetStagedRolloutRate,
    getStagedRolloutRate: mockGetStagedRolloutRate,
    disableStagedRollout: mockDisableStagedRollout
  }))
}));

jest.mock('@actions/core');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn()
}));

import * as core from '@actions/core';
import * as fs from 'fs';
import { run, isValidPublicationDate, parseBinarySeq } from './main';

const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>;
const mockGetBooleanInput = core.getBooleanInput as jest.MockedFunction<typeof core.getBooleanInput>;
const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>;
const mockSetOutput = core.setOutput as jest.MockedFunction<typeof core.setOutput>;
const mockSetSecret = core.setSecret as jest.MockedFunction<typeof core.setSecret>;
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
    'rollout-rate': '',
    'publication-type': '01',
    'start-publication-date': '',
    ...overrides
  };
  const bools: Record<string, boolean> = {
    'submit': false,
    'staged-rollout': false,
    'disable-existing-rollout': false,
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
  mockSubmitApp.mockResolvedValue(undefined);
  mockGetStagedRolloutBinaries.mockResolvedValue([]);
  mockAddStagedRolloutBinary.mockResolvedValue({ success: true });
  mockSetStagedRolloutRate.mockResolvedValue({ success: true });
  mockGetStagedRolloutRate.mockResolvedValue(null);
  mockDisableStagedRollout.mockResolvedValue({ success: true });
});

describe('isValidPublicationDate', () => {
  test.each([
    '2026-06-01 09:00:00',
    '2024-02-29 23:59:59',
    '2026-12-31 00:00:00'
  ])('accepts %s', (value) => {
    expect(isValidPublicationDate(value)).toBe(true);
  });

  test.each([
    '2026/06/01',
    '2026-06-01T09:00:00',
    '2026-13-01 09:00:00',
    '2026-06-31 09:00:00',
    '2025-02-29 09:00:00',
    '2026-06-01 24:00:00',
    '2026-06-01 09:60:00',
    '2026-06-01 09:00:60'
  ])('rejects %s', (value) => {
    expect(isValidPublicationDate(value)).toBe(false);
  });
});

describe('parseBinarySeq', () => {
  test('accepts numeric strings and numbers', () => {
    expect(parseBinarySeq('3')).toBe(3);
    expect(parseBinarySeq(' 12 ')).toBe(12);
    expect(parseBinarySeq(7)).toBe(7);
  });

  test('rejects missing or non-numeric values', () => {
    expect(parseBinarySeq(undefined)).toBeUndefined();
    expect(parseBinarySeq(null)).toBeUndefined();
    expect(parseBinarySeq('')).toBeUndefined();
    expect(parseBinarySeq('abc')).toBeUndefined();
    expect(parseBinarySeq({ seq: 3 })).toBeUndefined();
  });
});

describe('input validation', () => {
  test('masks the access token', async () => {
    setupInputs();
    await run();
    expect(mockSetSecret).toHaveBeenCalledWith('test-token');
  });

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
      expect.stringContaining('Unsupported file type')
    );
  });

  test.each(['150', '-5', '0', '', 'abc', '10.5', '1e1'])(
    "fails if rollout-rate is '%s' when staged-rollout is true",
    async (rate) => {
      setupInputs({ 'rollout-rate': rate }, { 'staged-rollout': true });
      await run();
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('rollout-rate must be an integer between 1 and 100')
      );
      expect(mockCreateUpdate).not.toHaveBeenCalled();
    }
  );

  test.each(['1', '50', '100'])('accepts rollout-rate %s when staged-rollout is true', async (rate) => {
    setupInputs({ 'rollout-rate': rate }, { 'staged-rollout': true });
    mockAddBinary.mockResolvedValue({ data: { binarySeq: '5' } });
    await run();
    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockSetStagedRolloutRate).toHaveBeenCalledWith('000012345678', Number(rate));
  });

  test('ignores an invalid rollout-rate when staged-rollout is false', async () => {
    setupInputs({ 'rollout-rate': 'abc' }, { 'staged-rollout': false });
    await run();
    expect(mockSetFailed).not.toHaveBeenCalled();
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
      expect.stringContaining('start-publication-date must be a valid date in yyyy-MM-dd HH:mm:ss format')
    );
  });

  test('fails if start-publication-date is an impossible date', async () => {
    setupInputs({ 'publication-type': '02', 'start-publication-date': '2026-13-45 99:99:99' });
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('start-publication-date must be a valid date')
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

  test('passes binary-seq-for-device-info to addBinary', async () => {
    setupInputs({ 'binary-seq-for-device-info': '2' });
    await run();
    expect(mockAddBinary).toHaveBeenCalledWith('000012345678', 'test-file-key', '2');
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

  test('fails with the error message when a client call rejects', async () => {
    setupInputs({}, { 'submit': true });
    mockUploadFile.mockRejectedValue(new Error('HTTP 403 /seller/createUploadSessionId: {"resultCode":"4008"}'));
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith('HTTP 403 /seller/createUploadSessionId: {"resultCode":"4008"}');
    expect(mockAddBinary).not.toHaveBeenCalled();
    expect(mockSubmitApp).not.toHaveBeenCalled();
  });

  test('does not touch staged rollout endpoints when disabled', async () => {
    setupInputs({}, { 'staged-rollout': false, 'disable-existing-rollout': true });
    await run();
    expect(mockGetStagedRolloutBinaries).not.toHaveBeenCalled();
    expect(mockGetStagedRolloutRate).not.toHaveBeenCalled();
    expect(mockDisableStagedRollout).not.toHaveBeenCalled();
    expect(mockAddStagedRolloutBinary).not.toHaveBeenCalled();
  });
});

describe('staged rollout', () => {
  test('uses binarySeq from the add-binary response when present', async () => {
    setupInputs({ 'rollout-rate': '10' }, { 'staged-rollout': true });
    mockAddBinary.mockResolvedValue({ resultCode: '0000', resultMessage: 'Ok', data: { binarySeq: '7' } });
    mockGetStagedRolloutBinaries.mockResolvedValueOnce([{ seq: 1 }]); // REGISTRATION before

    await run();

    // Only the pre-upload snapshot is taken; no post-upload diff is needed
    expect(mockGetStagedRolloutBinaries).toHaveBeenCalledTimes(1);
    expect(mockAddStagedRolloutBinary).toHaveBeenCalledWith('000012345678', 7);
    expect(mockSetStagedRolloutRate).toHaveBeenCalledWith('000012345678', 10);
    expect(mockSetOutput).toHaveBeenCalledWith('binary-seq', '7');
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  test('falls back to diffing before/after binaries when the response has no binarySeq', async () => {
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
    expect(mockAddStagedRolloutBinary).not.toHaveBeenCalled();
  });

  test('warns and uses the highest seq when multiple new binaries are found', async () => {
    setupInputs({ 'rollout-rate': '10' }, { 'staged-rollout': true });
    mockGetStagedRolloutBinaries
      .mockResolvedValueOnce([{ seq: 1 }])
      .mockResolvedValueOnce([{ seq: 1 }, { seq: 3 }, { seq: 2 }]);

    await run();

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('Multiple new binaries detected')
    );
    expect(mockAddStagedRolloutBinary).toHaveBeenCalledWith('000012345678', 3);
  });

  test('sets binary-seq output before the rollout calls so it survives a later failure', async () => {
    setupInputs({ 'rollout-rate': '10' }, { 'staged-rollout': true });
    mockAddBinary.mockResolvedValue({ data: { binarySeq: '4' } });
    mockSetStagedRolloutRate.mockRejectedValue(new Error('HTTP 400: {"resultCode":"3103"}'));

    await run();

    expect(mockSetOutput).toHaveBeenCalledWith('binary-seq', '4');
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('3103'));
  });

  test('does not run staged rollout when disabled', async () => {
    setupInputs({}, { 'staged-rollout': false });
    await run();
    expect(mockGetStagedRolloutBinaries).not.toHaveBeenCalled();
    expect(mockAddStagedRolloutBinary).not.toHaveBeenCalled();
    expect(mockSetOutput).not.toHaveBeenCalledWith('binary-seq', expect.anything());
  });

  describe('disable-existing-rollout', () => {
    test('is not consulted when the input is false', async () => {
      setupInputs({ 'rollout-rate': '10' }, { 'staged-rollout': true, 'disable-existing-rollout': false });
      mockAddBinary.mockResolvedValue({ data: { binarySeq: '5' } });

      await run();

      expect(mockGetStagedRolloutRate).not.toHaveBeenCalled();
      expect(mockDisableStagedRollout).not.toHaveBeenCalled();
    });

    test('disables an active SALE rollout before creating the update', async () => {
      setupInputs({ 'rollout-rate': '10' }, { 'staged-rollout': true, 'disable-existing-rollout': true });
      mockAddBinary.mockResolvedValue({ data: { binarySeq: '5' } });
      mockGetStagedRolloutRate.mockResolvedValue({ rolloutRate: 40, countries: [] });

      await run();

      expect(mockGetStagedRolloutRate).toHaveBeenCalledWith('000012345678', 'SALE');
      expect(mockDisableStagedRollout).toHaveBeenCalledWith('000012345678', 'SALE');
      expect(mockDisableStagedRollout.mock.invocationCallOrder[0])
        .toBeLessThan(mockCreateUpdate.mock.invocationCallOrder[0]);
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    test('does nothing when no SALE rollout exists', async () => {
      setupInputs({ 'rollout-rate': '10' }, { 'staged-rollout': true, 'disable-existing-rollout': true });
      mockAddBinary.mockResolvedValue({ data: { binarySeq: '5' } });
      mockGetStagedRolloutRate.mockResolvedValue(null);

      await run();

      expect(mockDisableStagedRollout).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    test('does nothing when the SALE rollout is already at 100%', async () => {
      setupInputs({ 'rollout-rate': '10' }, { 'staged-rollout': true, 'disable-existing-rollout': true });
      mockAddBinary.mockResolvedValue({ data: { binarySeq: '5' } });
      mockGetStagedRolloutRate.mockResolvedValue({ rolloutRate: 100 });

      await run();

      expect(mockDisableStagedRollout).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });
});

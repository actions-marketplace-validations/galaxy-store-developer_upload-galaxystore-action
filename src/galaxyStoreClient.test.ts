import axios from 'axios';
import { GalaxyStoreClient } from './galaxyStoreClient';

jest.mock('axios', () => {
  const mockAxiosInstance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    defaults: { headers: { Authorization: 'Bearer test-token' } },
    interceptors: {
      response: { use: jest.fn() }
    }
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockAxiosInstance),
      post: jest.fn()
    }
  };
});

function getMockClient() {
  const mockInstance = (axios.create as jest.Mock).mock.results[0].value;
  return mockInstance;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GalaxyStoreClient', () => {
  describe('createUpdate', () => {
    test('sends publicationType in request body', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.post.mockResolvedValue({ data: {} });

      await client.createUpdate('000012345678', '01');

      expect(mock.post).toHaveBeenCalledWith(
        expect.stringContaining('/seller/contentUpdate'),
        { contentId: '000012345678', publicationType: '01' }
      );
    });

    test('includes startPublicationDate when provided', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.post.mockResolvedValue({ data: {} });

      await client.createUpdate('000012345678', '02', '2026-06-01 09:00:00');

      expect(mock.post).toHaveBeenCalledWith(
        expect.stringContaining('/seller/contentUpdate'),
        {
          contentId: '000012345678',
          publicationType: '02',
          startPublicationDate: '2026-06-01 09:00:00'
        }
      );
    });
  });

  describe('addBinary', () => {
    test('sends correct body without binarySeqForDeviceInfo', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.post.mockResolvedValue({ data: { success: true } });

      await client.addBinary('000012345678', 'file-key-123');

      expect(mock.post).toHaveBeenCalledWith(
        expect.stringContaining('/seller/v2/content/binary'),
        { contentId: '000012345678', gms: 'N', filekey: 'file-key-123' }
      );
    });

    test('includes binarySeqForDeviceInfo when provided', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.post.mockResolvedValue({ data: { success: true } });

      await client.addBinary('000012345678', 'file-key-123', '2');

      expect(mock.post).toHaveBeenCalledWith(
        expect.stringContaining('/seller/v2/content/binary'),
        { contentId: '000012345678', gms: 'N', filekey: 'file-key-123', binarySeqForDeviceInfo: '2' }
      );
    });
  });

  describe('getStagedRolloutBinaries', () => {
    test('passes appStatus as query param', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.get.mockResolvedValue({
        data: { data: { binaries: [{ seq: 1, versionCode: '100' }] } }
      });

      const result = await client.getStagedRolloutBinaries('000012345678', 'SALE');

      expect(mock.get).toHaveBeenCalledWith(
        expect.stringContaining('/seller/v2/content/stagedRolloutBinary'),
        { params: { contentId: '000012345678', appStatus: 'SALE' } }
      );
      expect(result).toEqual([{ seq: 1, versionCode: '100' }]);
    });

    test('returns empty array on 404', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.get.mockRejectedValue(new Error('HTTP 404 /seller/v2/content/stagedRolloutBinary: {"resultCode":"3100"}'));

      const result = await client.getStagedRolloutBinaries('000012345678', 'REGISTRATION');

      expect(result).toEqual([]);
    });

    test('rethrows non-404 errors', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.get.mockRejectedValue(new Error('HTTP 500 /seller/v2/content/stagedRolloutBinary: server error'));

      await expect(client.getStagedRolloutBinaries('000012345678', 'SALE'))
        .rejects.toThrow('HTTP 500');
    });

    test('returns empty array when binaries is null', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.get.mockResolvedValue({
        data: { data: { binaries: null } }
      });

      const result = await client.getStagedRolloutBinaries('000012345678', 'SALE');

      expect(result).toEqual([]);
    });
  });

  describe('addStagedRolloutBinary', () => {
    test('sends PUT with correct body', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.put.mockResolvedValue({ data: { success: true } });

      await client.addStagedRolloutBinary('000012345678', 3);

      expect(mock.put).toHaveBeenCalledWith(
        expect.stringContaining('/seller/v2/content/stagedRolloutBinary'),
        { contentId: '000012345678', function: 'ADD', binarySeq: '3' }
      );
    });
  });

  describe('setStagedRolloutRate', () => {
    test('sends PUT with ENABLE_ROLLOUT and REGISTRATION status', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.put.mockResolvedValue({ data: { success: true } });

      await client.setStagedRolloutRate('000012345678', 25);

      expect(mock.put).toHaveBeenCalledWith(
        expect.stringContaining('/seller/v2/content/stagedRolloutRate'),
        {
          contentId: '000012345678',
          function: 'ENABLE_ROLLOUT',
          appStatus: 'REGISTRATION',
          rolloutRate: 25
        }
      );
    });
  });
});

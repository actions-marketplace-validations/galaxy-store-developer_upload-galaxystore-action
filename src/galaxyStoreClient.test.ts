import axios from 'axios';
import * as fs from 'fs';
import { GalaxyStoreClient, GalaxyStoreApiError } from './galaxyStoreClient';

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
      create: jest.fn(() => mockAxiosInstance)
    }
  };
});

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  openAsBlob: jest.fn()
}));

const mockOpenAsBlob = fs.openAsBlob as jest.MockedFunction<typeof fs.openAsBlob>;

function getMockClient() {
  const mockInstance = (axios.create as jest.Mock).mock.results[0].value;
  return mockInstance;
}

// Retrieve the rejection handler registered with interceptors.response.use
function getErrorInterceptor(): (error: unknown) => never {
  const mock = getMockClient();
  return mock.interceptors.response.use.mock.calls[0][1];
}

function notFound(url: string): GalaxyStoreApiError {
  return new GalaxyStoreApiError(404, url, { resultCode: '3100', resultMessage: 'Not found for contentId' });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GalaxyStoreClient', () => {
  describe('constructor', () => {
    test('configures auth headers and a request timeout', () => {
      new GalaxyStoreClient('account-id', 'token');

      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: expect.any(Number),
          headers: { Authorization: 'Bearer token', 'service-account-id': 'account-id' }
        })
      );
    });

    test('response interceptor converts HTTP errors into GalaxyStoreApiError', () => {
      new GalaxyStoreClient('account-id', 'token');
      const onRejected = getErrorInterceptor();
      const axiosError = {
        config: { url: 'https://devapi.samsungapps.com/seller/contentUpdate' },
        response: { status: 400, data: { resultCode: '1000', resultMessage: 'Invalid parameter' } }
      };

      let caught: unknown;
      try {
        onRejected(axiosError);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(GalaxyStoreApiError);
      const apiError = caught as GalaxyStoreApiError;
      expect(apiError.status).toBe(400);
      expect(apiError.url).toBe('https://devapi.samsungapps.com/seller/contentUpdate');
      expect(apiError.body).toEqual({ resultCode: '1000', resultMessage: 'Invalid parameter' });
      expect(apiError.message).toContain('HTTP 400');
      expect(apiError.message).toContain('Invalid parameter');
    });

    test('response interceptor rethrows network errors without a response unchanged', () => {
      new GalaxyStoreClient('account-id', 'token');
      const onRejected = getErrorInterceptor();
      const networkError = new Error('socket hang up');

      expect(() => onRejected(networkError)).toThrow(networkError);
    });
  });

  describe('createUploadSessionId', () => {
    test('returns sessionId and url', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.post.mockResolvedValue({ data: { sessionId: 'sess-1', url: 'https://seller.samsungapps.com/galaxyapi/fileUpload' } });

      const session = await client.createUploadSessionId();

      expect(mock.post).toHaveBeenCalledWith(expect.stringContaining('/seller/createUploadSessionId'));
      expect(session).toEqual({ sessionId: 'sess-1', url: 'https://seller.samsungapps.com/galaxyapi/fileUpload' });
    });

    test('throws when no sessionId is returned', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.post.mockResolvedValue({ data: {} });

      await expect(client.createUploadSessionId()).rejects.toThrow('did not return a sessionId');
    });
  });

  describe('uploadFile', () => {
    beforeEach(() => {
      mockOpenAsBlob.mockResolvedValue(new Blob(['binary-bytes']));
    });

    test('posts multipart FormData with the file and sessionId to the URL from the session', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.post
        .mockResolvedValueOnce({ data: { sessionId: 'sess-1', url: 'https://upload.example/fileUpload' } })
        .mockResolvedValueOnce({ data: { fileKey: 'key-1', fileName: 'app.aab', fileSize: '12', errorCode: null, errorMsg: null } });

      const result = await client.uploadFile('/builds/app.aab');

      expect(result.fileKey).toBe('key-1');
      expect(mockOpenAsBlob).toHaveBeenCalledWith('/builds/app.aab', { type: 'application/octet-stream' });

      const [url, body, config] = mock.post.mock.calls[1];
      expect(url).toBe('https://upload.example/fileUpload');
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('sessionId')).toBe('sess-1');
      const file = body.get('file') as File;
      expect(file).toBeInstanceOf(Blob);
      expect(file.name).toBe('app.aab');
      expect(config.timeout).toBeGreaterThan(60_000);
      expect(config.maxBodyLength).toBe(Infinity);
    });

    test('uses the APK MIME type for .apk files', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.post
        .mockResolvedValueOnce({ data: { sessionId: 'sess-1' } })
        .mockResolvedValueOnce({ data: { fileKey: 'key-1' } });

      await client.uploadFile('/builds/app.APK');

      expect(mockOpenAsBlob).toHaveBeenCalledWith('/builds/app.APK', { type: 'application/vnd.android.package-archive' });
    });

    test('falls back to the default upload URL when the session has no url', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.post
        .mockResolvedValueOnce({ data: { sessionId: 'sess-1' } })
        .mockResolvedValueOnce({ data: { fileKey: 'key-1' } });

      await client.uploadFile('/builds/app.aab');

      expect(mock.post.mock.calls[1][0]).toBe('https://seller.samsungapps.com/galaxyapi/fileUpload');
    });

    test('throws with the API error message when the upload returns errorMsg and no fileKey', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.post
        .mockResolvedValueOnce({ data: { sessionId: 'sess-1' } })
        .mockResolvedValueOnce({ data: { fileKey: null, errorCode: '7002', errorMsg: 'Invalid session id' } });

      await expect(client.uploadFile('/builds/app.aab')).rejects.toThrow('File upload failed: Invalid session id (errorCode 7002)');
    });

    test('throws when the upload response has no fileKey and no error message', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.post
        .mockResolvedValueOnce({ data: { sessionId: 'sess-1' } })
        .mockResolvedValueOnce({ data: {} });

      await expect(client.uploadFile('/builds/app.aab')).rejects.toThrow('did not include a fileKey');
    });
  });

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
      mock.post.mockResolvedValue({ data: { resultCode: '0000', resultMessage: 'Ok', data: { binarySeq: '3' } } });

      const result = await client.addBinary('000012345678', 'file-key-123');

      expect(mock.post).toHaveBeenCalledWith(
        expect.stringContaining('/seller/v2/content/binary'),
        { contentId: '000012345678', gms: 'N', filekey: 'file-key-123' }
      );
      expect(result.data?.binarySeq).toBe('3');
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

  describe('submitApp', () => {
    test('posts contentId to contentSubmit', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.post.mockResolvedValue({ data: undefined });

      await client.submitApp('000012345678');

      expect(mock.post).toHaveBeenCalledWith(
        expect.stringContaining('/seller/contentSubmit'),
        { contentId: '000012345678' }
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
      mock.get.mockRejectedValue(notFound('/seller/v2/content/stagedRolloutBinary'));

      const result = await client.getStagedRolloutBinaries('000012345678', 'REGISTRATION');

      expect(result).toEqual([]);
    });

    test('rethrows non-404 API errors', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.get.mockRejectedValue(new GalaxyStoreApiError(500, '/seller/v2/content/stagedRolloutBinary', 'server error'));

      await expect(client.getStagedRolloutBinaries('000012345678', 'SALE'))
        .rejects.toThrow('HTTP 500');
    });

    test('rethrows plain errors that merely mention 404', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.get.mockRejectedValue(new Error('connect ECONNREFUSED 10.4.0.4:404'));

      await expect(client.getStagedRolloutBinaries('000012345678', 'SALE'))
        .rejects.toThrow('ECONNREFUSED');
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

    test('returns empty array when the response has no data object', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.get.mockResolvedValue({
        data: { resultCode: '0000', resultMessage: 'Ok' }
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

  describe('getStagedRolloutRate', () => {
    test('returns the data object for the requested appStatus', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.get.mockResolvedValue({
        data: { resultCode: '0000', resultMessage: 'Ok', data: { rolloutRate: 25, countries: [] } }
      });

      const result = await client.getStagedRolloutRate('000012345678', 'SALE');

      expect(mock.get).toHaveBeenCalledWith(
        expect.stringContaining('/seller/v2/content/stagedRolloutRate'),
        { params: { contentId: '000012345678', appStatus: 'SALE' } }
      );
      expect(result).toEqual({ rolloutRate: 25, countries: [] });
    });

    test('returns null on 404', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.get.mockRejectedValue(notFound('/seller/v2/content/stagedRolloutRate'));

      const result = await client.getStagedRolloutRate('000012345678', 'SALE');

      expect(result).toBeNull();
    });

    test('rethrows non-404 errors', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.get.mockRejectedValue(new GalaxyStoreApiError(403, '/seller/v2/content/stagedRolloutRate', { resultCode: '4008' }));

      await expect(client.getStagedRolloutRate('000012345678', 'SALE')).rejects.toThrow('HTTP 403');
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

  describe('disableStagedRollout', () => {
    test('sends PUT with DISABLE_ROLLOUT for the given appStatus', async () => {
      const client = new GalaxyStoreClient('account-id', 'token');
      const mock = getMockClient();
      mock.put.mockResolvedValue({ data: { resultCode: '0000' } });

      await client.disableStagedRollout('000012345678', 'SALE');

      expect(mock.put).toHaveBeenCalledWith(
        expect.stringContaining('/seller/v2/content/stagedRolloutRate'),
        { contentId: '000012345678', function: 'DISABLE_ROLLOUT', appStatus: 'SALE' }
      );
    });
  });
});

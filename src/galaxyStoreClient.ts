import axios, { AxiosInstance, AxiosError } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'https://devapi.samsungapps.com';
// Fallback only: createUploadSessionId returns the upload URL to use.
const DEFAULT_UPLOAD_URL = 'https://seller.samsungapps.com/galaxyapi/fileUpload';
const REQUEST_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 15 * 60_000;
// Identifies traffic from this action so Samsung can filter it server-side
export const CLIENT_SOURCE = 'gh-action-galaxystore';

export type AppStatus = 'REGISTRATION' | 'SALE';

// Thrown for any HTTP error response from the Galaxy Store API. Carries the status code and the
// parsed response body so callers can branch on status instead of parsing message strings.
export class GalaxyStoreApiError extends Error {
  readonly status: number;
  readonly url: string | undefined;
  readonly body: unknown;

  constructor(status: number, url: string | undefined, body: unknown) {
    super(`HTTP ${status} ${url ?? '(unknown url)'}: ${JSON.stringify(body)}`);
    this.name = 'GalaxyStoreApiError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export interface AppInfo {
  contentId: string;
  appTitle: string;
  contentStatus: string;
  defaultLanguageCode: string;
  longDescription: string;
  shortDescription: string;
  [key: string]: unknown;
}

export interface UploadSession {
  sessionId: string;
  url?: string;
}

export interface UploadResult {
  fileKey: string;
  fileName?: string;
  fileSize?: string | number;
  errorCode?: string | null;
  errorMsg?: string | null;
  [key: string]: unknown;
}

// Response of POST /seller/v2/content/binary. `data.binarySeq` was added in API release 2026.05.13.
export interface AddBinaryResult {
  resultCode?: string;
  resultMessage?: string;
  data?: {
    binarySeq?: string | number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface StagedRolloutBinary {
  seq: number;
  versionCode: string;
  versionName: string;
  fileName: string;
  fileSize: string;
  rolloutStatus: string;
  appStatus: string;
}

export interface StagedRolloutRate {
  rolloutRate?: number;
  countries?: Array<{ countryCode: string; rolloutRate: number }>;
  [key: string]: unknown;
}

// Envelope used by the /seller/v2/* endpoints
interface V2Response<T> {
  resultCode?: string;
  resultMessage?: string;
  data?: T;
}

function isNotFound(error: unknown): boolean {
  return error instanceof GalaxyStoreApiError && error.status === 404;
}

// Client for the Samsung Galaxy Store Seller API.
// Handles authentication and wraps all API calls used by this action.
export class GalaxyStoreClient {
  private client: AxiosInstance;

  constructor(serviceAccountId: string, accessToken: string) {
    this.client = axios.create({
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'service-account-id': serviceAccountId,
        'X-Client-Source': CLIENT_SOURCE
      }
    });

    this.client.interceptors.response.use(
      response => response,
      (error: AxiosError) => {
        if (error.response) {
          const url = error.config?.url ?? error.response.config?.url;
          throw new GalaxyStoreApiError(error.response.status, url, error.response.data);
        }
        throw error;
      }
    );
  }

  // Get a session ID (and the upload URL) required by the file upload endpoint
  async createUploadSessionId(): Promise<UploadSession> {
    const response = await this.client.post<UploadSession>(
      `${BASE_URL}/seller/createUploadSessionId`
    );
    const session = response.data;
    if (!session?.sessionId) {
      throw new Error(`createUploadSessionId did not return a sessionId: ${JSON.stringify(session)}`);
    }
    return session;
  }

  // Upload a binary file. Uses a separate host from the rest of the API.
  // The file is streamed from disk via a Blob; axios builds the multipart body,
  // sets the boundary and Content-Length, and escapes field names/filenames.
  async uploadFile(filePath: string): Promise<UploadResult> {
    const session = await this.createUploadSessionId();

    const form = new FormData();
    const blob = await fs.openAsBlob(filePath, { type: mimeTypeFor(filePath) });
    form.append('file', blob, path.basename(filePath));
    form.append('sessionId', session.sessionId);

    const response = await this.client.post<UploadResult>(session.url || DEFAULT_UPLOAD_URL, form, {
      timeout: UPLOAD_TIMEOUT_MS,
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    // The upload endpoint can answer HTTP 200 with errorCode/errorMsg populated and no fileKey.
    const result = response.data;
    if (!result || !result.fileKey) {
      const detail = result?.errorMsg
        ? `${result.errorMsg} (errorCode ${result.errorCode ?? 'n/a'})`
        : `response did not include a fileKey: ${JSON.stringify(result)}`;
      throw new Error(`File upload failed: ${detail}`);
    }
    return result;
  }

  // Open an update session for the app, specifying how/when to publish.
  // Only contentId and publicationType are sent; other metadata is left untouched.
  async createUpdate(contentId: string, publicationType: string, startPublicationDate?: string): Promise<void> {
    const body: Record<string, string> = { contentId, publicationType };
    if (startPublicationDate) {
      body.startPublicationDate = startPublicationDate;
    }
    await this.client.post(`${BASE_URL}/seller/contentUpdate`, body);
  }

  // Register an uploaded binary (by fileKey) against a content ID
  async addBinary(contentId: string, fileKey: string, binarySeqForDeviceInfo?: string): Promise<AddBinaryResult> {
    const body: Record<string, string> = {
      contentId,
      gms: 'N',
      filekey: fileKey
    };
    if (binarySeqForDeviceInfo) {
      body.binarySeqForDeviceInfo = binarySeqForDeviceInfo;
    }
    const response = await this.client.post<AddBinaryResult>(`${BASE_URL}/seller/v2/content/binary`, body);
    return response.data;
  }

  // Fetch app metadata (not currently used by the action, available for future use)
  async getAppInfo(contentId: string): Promise<AppInfo[]> {
    const response = await this.client.get<AppInfo[]>(
      `${BASE_URL}/seller/contentInfo`,
      { params: { contentId } }
    );
    return response.data;
  }

  // Submit the app for review (API answers 204 No Content on success)
  async submitApp(contentId: string): Promise<unknown> {
    const response = await this.client.post(`${BASE_URL}/seller/contentSubmit`, { contentId });
    return response.data;
  }

  // List binaries in a staged rollout group. Returns empty array if none exist (API returns 404).
  async getStagedRolloutBinaries(contentId: string, appStatus: AppStatus): Promise<StagedRolloutBinary[]> {
    try {
      const response = await this.client.get<V2Response<{ binaries: StagedRolloutBinary[] | null }>>(
        `${BASE_URL}/seller/v2/content/stagedRolloutBinary`,
        { params: { contentId, appStatus } }
      );
      return response.data?.data?.binaries ?? [];
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  }

  // Add a binary (by seq number) to the staged rollout group
  async addStagedRolloutBinary(contentId: string, binarySeq: number): Promise<unknown> {
    const response = await this.client.put(`${BASE_URL}/seller/v2/content/stagedRolloutBinary`, {
      contentId,
      function: 'ADD',
      binarySeq: String(binarySeq)
    });
    return response.data;
  }

  // Read the current staged rollout rate for REGISTRATION or SALE. Returns null if none exists (API returns 404).
  async getStagedRolloutRate(contentId: string, appStatus: AppStatus): Promise<StagedRolloutRate | null> {
    try {
      const response = await this.client.get<V2Response<StagedRolloutRate>>(
        `${BASE_URL}/seller/v2/content/stagedRolloutRate`,
        { params: { contentId, appStatus } }
      );
      return response.data?.data ?? null;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  // Enable a staged rollout (or raise the rate of an active one) on the given version.
  // Samsung requires each new rate to be higher than the previous one for that version.
  async setStagedRolloutRate(contentId: string, rolloutRate: number, appStatus: AppStatus = 'REGISTRATION'): Promise<unknown> {
    const response = await this.client.put(`${BASE_URL}/seller/v2/content/stagedRolloutRate`, {
      contentId,
      function: 'ENABLE_ROLLOUT',
      appStatus,
      rolloutRate
    });
    return response.data;
  }

  // Disable an existing staged rollout (Samsung requires this before enabling one on a new update)
  async disableStagedRollout(contentId: string, appStatus: AppStatus): Promise<unknown> {
    const response = await this.client.put(`${BASE_URL}/seller/v2/content/stagedRolloutRate`, {
      contentId,
      function: 'DISABLE_ROLLOUT',
      appStatus
    });
    return response.data;
  }
}

function mimeTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.apk': return 'application/vnd.android.package-archive';
    // There is no registered MIME type for Android App Bundles
    default: return 'application/octet-stream';
  }
}

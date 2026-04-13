import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'https://devapi.samsungapps.com';
const UPLOAD_URL = 'https://seller.samsungapps.com/galaxyapi/fileUpload';

export interface AppInfo {
  contentId: string;
  appTitle: string;
  contentStatus: string;
  defaultLanguageCode: string;
  longDescription: string;
  shortDescription: string;
  [key: string]: unknown;
}

export interface UploadResult {
  fileKey: string;
  [key: string]: unknown;
}

export class GalaxyStoreClient {
  private client: AxiosInstance;
  private serviceAccountId: string;

  constructor(serviceAccountId: string, accessToken: string) {
    this.serviceAccountId = serviceAccountId;
    this.client = axios.create({
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'service-account-id': serviceAccountId
      }
    });
  }

  async createUploadSessionId(): Promise<string> {
    const response = await this.client.post<{ sessionId: string }>(
      `${BASE_URL}/seller/createUploadSessionId`
    );
    return response.data.sessionId;
  }

  async uploadFile(filePath: string): Promise<UploadResult> {
    const sessionId = await this.createUploadSessionId();

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: mimeTypeFor(filePath)
    });
    form.append('sessionId', sessionId);

    const response = await axios.post<UploadResult>(UPLOAD_URL, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: this.client.defaults.headers.Authorization as string,
        'service-account-id': this.serviceAccountId
      }
    });

    return response.data;
  }

  async createUpdate(contentId: string): Promise<void> {
    await this.client.post(`${BASE_URL}/seller/contentUpdate`, { contentId });
  }

  async addBinary(contentId: string, fileKey: string): Promise<unknown> {
    const response = await this.client.post(`${BASE_URL}/seller/v2/content/binary`, {
      contentId,
      gms: 'N',
      filekey: fileKey,
      binarySeqForDeviceInfo: '1'
    });
    return response.data;
  }

  async getAppInfo(contentId: string): Promise<AppInfo[]> {
    const response = await this.client.get<AppInfo[]>(
      `${BASE_URL}/seller/contentInfo`,
      { params: { contentId } }
    );
    return response.data;
  }

  async submitApp(contentId: string): Promise<unknown> {
    const response = await this.client.post(`${BASE_URL}/seller/contentSubmit`, { contentId });
    return response.data;
  }
}

function mimeTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.apk': return 'application/vnd.android.package-archive';
    case '.aab': return 'application/x-authorware-bin';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

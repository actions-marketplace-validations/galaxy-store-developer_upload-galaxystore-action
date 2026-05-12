# Upload to Samsung Galaxy Store

A GitHub Action to upload Android APK and AAB files to the Samsung Galaxy Store via the Seller API.

This action requires you to create a Galaxy Store service account and access token, more information can be found on the [Samsung Developer Portal](https://developer.samsung.com/galaxy-store/galaxy-store-developer-api/create-an-access-token.html)

## Features

- Upload `.apk` or `.aab` binaries to the Galaxy Store
- Optionally submit the app for review after uploading
- Optionally add the uploaded binary to a staged rollout group with a configurable rollout rate
- Configurable publication type (automatic, scheduled, or manual)

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `access-token` | Yes | | Galaxy Store API access token |
| `service-account-id` | Yes | | Galaxy Store service account ID |
| `content-id` | Yes | | 12-digit content ID of the app in the Galaxy Store |
| `package-path` | Yes | | Path to the `.apk` or `.aab` file to upload |
| `binary-seq-for-device-info` | No | | Sequence number of the device info configuration for the binary. Only set if your app requires a specific device configuration sequence. |
| `publication-type` | No | `01` | When the app is published: `01` = automatically after review, `02` = on a scheduled date, `03` = manually by the seller |
| `start-publication-date` | No | | Publication date in `yyyy-MM-dd HH:mm:ss` format. Required when `publication-type` is `02`. |
| `submit` | No | `false` | Whether to submit the app for review after uploading |
| `staged-rollout` | No | `false` | Whether to add the uploaded binary to a staged rollout group |
| `rollout-rate` | No | `0` | Staged rollout percentage (0-100). Only used when `staged-rollout` is `true`. |

## Outputs

| Output | Description |
|--------|-------------|
| `upload-result` | JSON string containing the add binary API response |
| `binary-seq` | The binary sequence number of the uploaded binary (only set when `staged-rollout` is `true`) |

## Authentication

This action requires a Galaxy Store API access token and service account ID. These can be obtained from the [Samsung Galaxy Store Seller Portal](https://seller.samsungapps.com/).

Store both values as [GitHub Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) in your repository.

## Usage

### Basic upload

```yaml
- uses: cristian-samsung/upload-galaxystore-action@main
  with:
    access-token: ${{ secrets.GALAXY_ACCESS_TOKEN }}
    service-account-id: ${{ secrets.GALAXY_SERVICE_ACCOUNT_ID }}
    content-id: '000012345678'
    package-path: './app-release.aab'
```

### Upload and submit for review

```yaml
- uses: cristian-samsung/upload-galaxystore-action@main
  with:
    access-token: ${{ secrets.GALAXY_ACCESS_TOKEN }}
    service-account-id: ${{ secrets.GALAXY_SERVICE_ACCOUNT_ID }}
    content-id: '000012345678'
    package-path: './app-release.aab'
    submit: true
```

### Upload with scheduled publication

```yaml
- uses: cristian-samsung/upload-galaxystore-action@main
  with:
    access-token: ${{ secrets.GALAXY_ACCESS_TOKEN }}
    service-account-id: ${{ secrets.GALAXY_SERVICE_ACCOUNT_ID }}
    content-id: '000012345678'
    package-path: './app-release.aab'
    publication-type: '02'
    start-publication-date: '2026-06-01 09:00:00'
    submit: true
```

### Upload with staged rollout

```yaml
- uses: cristian-samsung/upload-galaxystore-action@main
  id: upload
  with:
    access-token: ${{ secrets.GALAXY_ACCESS_TOKEN }}
    service-account-id: ${{ secrets.GALAXY_SERVICE_ACCOUNT_ID }}
    content-id: '000012345678'
    package-path: './app-release.aab'
    staged-rollout: true
    rollout-rate: 10
    submit: true
```
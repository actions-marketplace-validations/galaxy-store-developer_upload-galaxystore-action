# Upload to Samsung Galaxy Store

A GitHub Action to upload Android APK and AAB files to the Samsung Galaxy Store via the [Galaxy Store Developer API](https://developer.samsung.com/galaxy-store/galaxy-store-developer-api.html).

This action requires a Galaxy Store service account and access token. See [Create an access token](https://developer.samsung.com/galaxy-store/galaxy-store-developer-api/create-an-access-token.html) on the Samsung Developer Portal.

## Features

- Upload `.apk` or `.aab` binaries to the Galaxy Store
- Optionally submit the app for review after uploading
- Optionally add the uploaded binary to a staged rollout group with a configurable rollout rate
- Optionally disable a still-active staged rollout on the live version before starting the new one
- Configurable publication type (automatic, scheduled, or manual)

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `access-token` | Yes | | Galaxy Store API access token |
| `service-account-id` | Yes | | Galaxy Store service account ID |
| `content-id` | Yes | | 12-digit content ID of the app in the Galaxy Store |
| `package-path` | Yes | | Path to the `.apk` or `.aab` file to upload |
| `binary-seq-for-device-info` | No | | `binarySeq` of an existing binary whose device configuration should be copied to the new binary. See [Finding a binary sequence number](#finding-a-binary-sequence-number). |
| `publication-type` | No | `01` | When the app is published: `01` = automatically after review, `02` = on a scheduled date, `03` = manually by the seller |
| `start-publication-date` | No | | Publication date in `yyyy-MM-dd HH:mm:ss` format. Required when `publication-type` is `02`. |
| `submit` | No | `false` | Whether to submit the app for review after uploading |
| `staged-rollout` | No | `false` | Whether to add the uploaded binary to a staged rollout group |
| `rollout-rate` | No | | Staged rollout percentage as an integer from `1` to `100`. Required when `staged-rollout` is `true`; ignored otherwise. |
| `disable-existing-rollout` | No | `false` | When `staged-rollout` is `true`, disable a staged rollout that is still below 100% on the **live** version before enabling the new one. See [Staged rollout preconditions](#staged-rollout-preconditions). |

## Outputs

| Output | Description |
|--------|-------------|
| `upload-result` | JSON string containing the add binary API response |
| `binary-seq` | The binary sequence number of the uploaded binary (only set when `staged-rollout` is `true`) |

## Authentication

This action requires a Galaxy Store API access token and service account ID.

1. Create a service account in the [Seller Portal](https://seller.samsungapps.com/) (Assistance > API Service) and note the service account ID.
2. Create an access token by signing a JWT with the service account's private key and calling `POST https://devapi.samsungapps.com/auth/accessToken`. Samsung's [Create an access token](https://developer.samsung.com/galaxy-store/galaxy-store-developer-api/create-an-access-token.html) page walks through this. The token needs the `publishing` scope.
3. Store both values as [GitHub Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) in your repository.

Access tokens do not expire on their own, but they can be revoked from the Seller Portal. If uploads start failing with HTTP 401, create a new token and update the secret.

The action calls `core.setSecret` on the token, so it is masked in logs even if it did not come from a repository secret.

## Usage

Pin to a release tag (or a full commit SHA) rather than `@main` so that changes to this action cannot alter your release pipeline without review.

### Basic upload

```yaml
- uses: cristian-samsung/upload-galaxystore-action@v1
  with:
    access-token: ${{ secrets.GALAXY_ACCESS_TOKEN }}
    service-account-id: ${{ secrets.GALAXY_SERVICE_ACCOUNT_ID }}
    content-id: '000012345678'
    package-path: './app-release.aab'
```

### Upload and submit for review

```yaml
- uses: cristian-samsung/upload-galaxystore-action@v1
  with:
    access-token: ${{ secrets.GALAXY_ACCESS_TOKEN }}
    service-account-id: ${{ secrets.GALAXY_SERVICE_ACCOUNT_ID }}
    content-id: '000012345678'
    package-path: './app-release.aab'
    submit: true
```

### Upload with scheduled publication

```yaml
- uses: cristian-samsung/upload-galaxystore-action@v1
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
- uses: cristian-samsung/upload-galaxystore-action@v1
  id: upload
  with:
    access-token: ${{ secrets.GALAXY_ACCESS_TOKEN }}
    service-account-id: ${{ secrets.GALAXY_SERVICE_ACCOUNT_ID }}
    content-id: '000012345678'
    package-path: './app-release.aab'
    staged-rollout: true
    rollout-rate: 10
    disable-existing-rollout: true
    submit: true

- name: Show the new binary sequence number
  env:
    BINARY_SEQ: ${{ steps.upload.outputs.binary-seq }}
  run: echo "New binary seq: $BINARY_SEQ"
```

## How it works

The action calls the Galaxy Store Content Publish API in this order:

1. *(optional, `disable-existing-rollout`)* `GET /seller/v2/content/stagedRolloutRate?appStatus=SALE` and, if a rollout below 100% is active, `PUT /seller/v2/content/stagedRolloutRate` with `DISABLE_ROLLOUT`.
2. `POST /seller/contentUpdate` with `contentId` and `publicationType` (plus `startPublicationDate` when scheduled). This moves the app into the REGISTERING (Updating) state. No other app metadata is sent, so titles, descriptions and country settings are left untouched.
3. `POST /seller/createUploadSessionId`, then a multipart `POST` of the file to the upload URL returned by that call.
4. `POST /seller/v2/content/binary` to register the uploaded file against the app. The `binarySeq` in this response is used for the staged rollout steps.
5. *(optional, `staged-rollout`)* `PUT /seller/v2/content/stagedRolloutBinary` with `ADD`, then `PUT /seller/v2/content/stagedRolloutRate` with `ENABLE_ROLLOUT` and the given `rollout-rate`.
6. *(optional, `submit`)* `POST /seller/contentSubmit`.

If the add-binary response does not include `binarySeq` (API releases before 2026.05.13), the action falls back to comparing the staged-rollout binary list before and after the upload.

## Notes and caveats

### Publication types

- `01` publishes automatically once the review passes.
- `02` publishes at `start-publication-date` once the review passes. Samsung's documentation does not state the timezone for this field; test with your own app before relying on an exact time.
- `03` leaves the update in a pending state after review. You must release it manually in the Seller Portal or with `POST /seller/contentStatusUpdate` (`contentStatus: FOR_SALE`) before another update can be created.

### Staged rollout preconditions

Samsung requires that any staged rollout on the live (SALE) version be disabled, or already at 100%, before a staged rollout can be enabled on a new update. Otherwise the rate call fails with result codes in the 3103 to 3105 range.

Set `disable-existing-rollout: true` to have the action handle this. It only disables a rollout that is still below 100%, and it only touches the live version. Because this changes what your current users receive, it is off by default.

Each new rollout rate must be greater than the previous one for the same version. Increasing the rate after release is done with `PUT /seller/v2/content/stagedRolloutRate` and is not covered by this action.

### Finding a binary sequence number

`binary-seq-for-device-info` copies the device configuration (supported devices, resolutions, and so on) from an existing binary to the new one. The value is the `binarySeq` of that existing binary, which is not shown in the Seller Portal. Retrieve it with:

```bash
curl -H "Authorization: Bearer $TOKEN" -H "service-account-id: $SERVICE_ACCOUNT_ID" \
  "https://devapi.samsungapps.com/seller/contentInfo?contentId=000012345678"
```

and read `binaryList[].binarySeq` from the response.

### Error output

Any HTTP error from the API fails the job with the status code, the URL, and the full response body, for example:

```text
HTTP 400 https://devapi.samsungapps.com/seller/v2/content/stagedRolloutRate: {"resultCode":"3103","resultMessage":"..."}
```

Result codes are documented on Samsung's [Failure response codes](https://developer.samsung.com/galaxy-store/galaxy-store-developer-api/content-publish-api/failure-response-codes.html) page.

## Development

```bash
# Install dependencies
npm install

# Run unit tests
npm test

# Build (must be run before committing changes to src/)
npm run build
```

The `dist/index.js` bundle must be committed as it is what GitHub Actions executes at runtime. The CI workflow fails if `dist/` does not match the source.

### Releasing

1. Merge to `main` with a rebuilt `dist/`.
2. Tag the release, for example `v1.1.0`, and move the floating major tag:

   ```bash
   git tag v1.1.0
   git tag -f v1
   git push origin v1.1.0
   git push -f origin v1
   ```

## License

This project is licensed under the [Apache License 2.0](LICENSE).

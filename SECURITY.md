# Security Policy

## Supported Versions

Only the latest released major version of this action receives security fixes. Pin your
workflows to the latest release tag (or a full commit SHA) and keep them up to date.

## Reporting a Vulnerability

Please do **not** report security vulnerabilities through public GitHub issues.

Instead, use GitHub's private vulnerability reporting: open the **Security** tab of this
repository and choose **Report a vulnerability**. You will receive a response as soon as
possible, normally within a few business days.

Please include:

- A description of the issue and its impact
- Steps to reproduce (a minimal workflow snippet if applicable)
- Any suggested remediation

## Scope notes

- This action sends your Galaxy Store API access token only to `*.samsungapps.com` hosts
  over HTTPS and masks it (and the service account ID) in workflow logs.
- Treat the `access-token` and `service-account-id` inputs as secrets: store them in GitHub
  Actions secrets, never in plain workflow files.

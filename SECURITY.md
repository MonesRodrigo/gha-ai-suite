# Security Policy

## Supported versions

Only the latest release is supported. Consumers should pin a full commit SHA
and update through Dependabot.

## Reporting a vulnerability

Please **do not** open a public issue or pull request for security problems.

Report privately through GitHub instead:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the issue, how to reproduce it and its potential impact.

This is a personal project maintained on a best-effort basis. Confirmed issues
are fixed in a new release and disclosed through a GitHub Security Advisory.

## Security model

- Every workflow declares least-privilege `permissions`; the build and quality
  workflows only need `contents: read`.
- Checkouts use `persist-credentials: false`, so the token is not left in the
  git config for later steps.
- Third-party actions are pinned to full commit SHAs.
- Reusable workflows load this suite's own actions from `job.workflow_sha`, so
  a consumer pinning one SHA runs exactly that code end to end.
- Workflow inputs reach shell steps through `env:`, never through direct
  expression interpolation.

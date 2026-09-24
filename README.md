# gha-ai-suite

Reusable GitHub Actions workflows for frontend projects: build once, then run
quality gates on the same artifact. Framework-agnostic — it works with any
project whose build produces a static output directory.

> `v1.0.0` ships the build workflow and quality gates. AI code review is
> planned for `v1.1`.

## Usage

Pin the workflow to a **full commit SHA** and keep the release in a comment, so
Dependabot can update both:

```yaml
jobs:
  build:
    name: Build
    uses: MonesRodrigo/gha-ai-suite/.github/workflows/build.yml@<commit-sha> # v1.0.0
    with:
      output-dir: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@<commit-sha> # v8.0.1
        with:
          name: ${{ needs.build.outputs.artifact-name }}
          path: dist

  quality:
    name: Quality
    needs: build
    uses: MonesRodrigo/gha-ai-suite/.github/workflows/quality.yml@<commit-sha> # v1.0.0
    with:
      artifact-name: ${{ needs.build.outputs.artifact-name }}
      base-path: /my-project/
```

The build job keeps the id `build`, so your required status check is reported
as `<your job name> / build` (for example `Build / build`).

## Workflows

### `build.yml`

Checks out your repository, installs dependencies from the lockfile, runs the
build and uploads the output directory as an artifact.

| Input | Default | Description |
| :-- | :-- | :-- |
| `working-directory` | `.` | Directory containing `package.json`. |
| `node-version` | *(version file)* | Overrides `.nvmrc`, `.node-version`, `.tool-versions` or `package.json` engines. |
| `build-command` | `<pm> run build` | Command that builds the site. |
| `output-dir` | `dist` | Build output, relative to `working-directory`. |
| `artifact-name` | `dist` | Name of the uploaded artifact. |
| `retention-days` | `3` | How long to keep the artifact. |

| Output | Description |
| :-- | :-- |
| `artifact-name` | Name of the artifact, for `actions/download-artifact`. |

Required permissions: `contents: read`.

### `quality.yml`

Runs three independent jobs against the build artifact, so every gate inspects
exactly what will be deployed. Each can be switched off.

| Job | What it checks | Fails when |
| :-- | :-- | :-- |
| `bundle` | Gzipped JS + CSS (HTML is reported, not budgeted) | The total exceeds `bundle-budget-kb` |
| `a11y` | axe on **every page in the sitemap** | A violation matches `a11y-fail-on`, a sitemap page does not load, or no page can be discovered |
| `lighthouse` | Lighthouse CI, several runs per URL | An assertion at `error` level fails (the default config only warns) |

| Input | Default | Description |
| :-- | :-- | :-- |
| `artifact-name` | `dist` | Artifact to test, usually `needs.build.outputs.artifact-name`. |
| `base-path` | `/` | Base path the site is published under. |
| `bundle` / `a11y` / `lighthouse` | `true` | Toggle each job. |
| `bundle-budget-kb` | `250` | Maximum gzipped JS + CSS. |
| `a11y-fail-on` | `critical,serious` | axe impact levels that fail the job. |
| `a11y-tags` | `wcag2a,wcag2aa,wcag21aa` | axe rule tags. |
| `a11y-sitemap` | *(auto)* | `sitemap-index.xml`, `sitemap.xml` or `sitemap-0.xml`. Indexes are followed. |
| `lighthouse-paths` | *(base path)* | Comma-separated URL paths to audit. |
| `lighthouse-runs` | `3` | Runs per URL; CI hardware is noisy. |
| `lighthouse-config` | *(warn-only)* | A `lighthouserc.json` in your repository. |
| `lighthouse-public-storage` | `false` | Upload reports to public temporary storage. |

| Output | Description |
| :-- | :-- |
| `a11y-report` | Artifact with the axe SARIF report. |

Required permissions: `contents: read`. To show accessibility findings in code
scanning, download the `a11y-report` artifact in your own job and upload it with
`github/codeql-action/upload-sarif`, granting `security-events: write` there.

## Actions

### `actions/setup`

Detects the package manager, sets up Node from the project's version file and
installs dependencies with `npm ci` or `pnpm install --frozen-lockfile`.

- The package manager comes from `packageManager` in `package.json`, or from
  the single lockfile present.
- pnpm projects must declare `packageManager` (for example `pnpm@11.1.3`), so
  the exact version is installed.
- Yarn is not supported yet.

### `actions/serve`

Serves a static directory on `127.0.0.1` under a base path, in the background,
for the rest of the job. Only `GET` and `HEAD` are allowed, and requests can
never resolve outside the served directory, including through symlinks.

### `actions/bundle-size`

Fails when gzipped JS + CSS exceeds `budget-kb`. An invalid budget fails the
step instead of silently disabling the gate.

### `actions/a11y`

Runs axe with Playwright on every page listed in the sitemap. Its dependencies
are pinned in a committed lockfile and installed with `npm ci --ignore-scripts`.

## Security model

- **Pinned end to end.** Reusable workflows check out this suite's own actions
  at `job.workflow_sha`, so pinning one SHA pins everything the workflow runs.
  If that commit cannot be resolved, the job fails instead of falling back.
- **Least privilege.** Workflows only request `contents: read`; checkouts use
  `persist-credentials: false`.
- **No expression injection.** Inputs reach shell steps through `env:`.
- **Pinned dependencies.** Third-party actions are pinned to commit SHAs and
  updated by Dependabot.
- **Linted.** CI runs `actionlint` (with `shellcheck`) from a checksum-verified
  release.
- **Gates proven to fail.** CI feeds each gate input it must reject (an
  inaccessible page, an impossible budget, a wrong base path) and fails if any
  of them passes. A check that has only ever been seen green proves nothing.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Development

```bash
nvm use
npm test          # unit tests (node:test, no dependencies)
```

`fixtures/site` is a dependency-free static site served under `/fixture/`. CI
calls the reusable workflows against it exactly as a consumer would.
`fixtures/a11y-broken` is deliberately inaccessible, so CI can prove the
accessibility gate fails.

## Versioning

Releases follow [semantic versioning](https://semver.org/). A **major** version
is required for anything that can break a caller, including:

- removing or renaming an input or output, or changing its default behaviour;
- renaming a job, because required status checks match on job names;
- requiring broader `permissions`.

Releases are **immutable**: once published, a release tag cannot be moved or
deleted, and GitHub attaches a signed release attestation. Pin the commit SHA
of a release and let Dependabot propose upgrades. See
[verifying the integrity of a release](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity).

## Roadmap

- `v1.0.0` — build workflow, quality gates (bundle size, accessibility, Lighthouse).
- `v1.1.0` — AI code review with a configurable, OpenAI-compatible provider.

## License

[MIT](LICENSE)

# gha-ai-suite

Reusable GitHub Actions workflows for frontend projects: build once, then run
quality gates on the same artifact. Framework-agnostic — it works with any
project whose build produces a static output directory.

> Status: pre-release. `v1.0.0` ships the build workflow and quality gates.
> AI code review arrives in `v1.1`.

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

## Actions

### `actions/setup`

Detects the package manager, sets up Node from the project's version file and
installs dependencies with `npm ci` or `pnpm install --frozen-lockfile`.

- The package manager comes from `packageManager` in `package.json`, or from
  the single lockfile present.
- pnpm projects must declare `packageManager` (for example `pnpm@11.1.3`), so
  the exact version is installed.
- Yarn is not supported yet.

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

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Development

```bash
nvm use
npm test          # unit tests (node:test, no dependencies)
```

`fixtures/site` is a dependency-free static site served under `/fixture/`. CI
calls the reusable workflows against it exactly as a consumer would.

## Roadmap

- `v1.0.0` — build workflow, quality gates (bundle size, accessibility, Lighthouse).
- `v1.1.0` — AI code review with a configurable, OpenAI-compatible provider.

## License

[MIT](LICENSE)

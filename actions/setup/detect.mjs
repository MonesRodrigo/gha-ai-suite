import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LOCKFILES = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' }
const NODE_VERSION_FILES = ['.nvmrc', '.node-version', '.tool-versions']

/**
 * Resolve the package manager from `packageManager` or, failing that, from the
 * single lockfile present. Throws with an actionable message otherwise.
 */
export function detectPackageManager(packageJson, hasFile) {
  const declared = packageJson?.packageManager?.split('@')[0]
  const found = Object.keys(LOCKFILES).filter((pm) => hasFile(LOCKFILES[pm]))

  if (!declared && found.length > 1) {
    throw new Error(
      `Found several lockfiles (${found.map((pm) => LOCKFILES[pm]).join(', ')}). ` +
        'Declare "packageManager" in package.json to pick one.',
    )
  }
  const pm = declared ?? found[0]
  if (!pm) throw new Error('No lockfile found. Commit one so installs are reproducible.')
  if (!Object.hasOwn(LOCKFILES, pm)) throw new Error(`Unsupported package manager "${pm}".`)
  if (pm === 'yarn') throw new Error('Yarn is not supported yet. Use npm or pnpm.')
  if (!hasFile(LOCKFILES[pm])) throw new Error(`"${pm}" is declared but ${LOCKFILES[pm]} is missing.`)
  if (pm === 'pnpm' && !declared) {
    throw new Error('pnpm projects must declare "packageManager" (for example "pnpm@11.1.3") so the exact version is installed.')
  }
  return { packageManager: pm, lockfile: LOCKFILES[pm] }
}

/** First Node version file present, falling back to package.json `engines`. */
export function detectNodeVersionFile(hasFile) {
  return NODE_VERSION_FILES.find((file) => hasFile(file)) ?? 'package.json'
}

// Workflow-command escaping, so file content cannot inject extra commands.
const escapeCommand = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

function main() {
  const dir = process.env.WORKING_DIRECTORY || '.'
  if (/[\r\n]/.test(dir)) throw new Error('working-directory must be a single line.')

  const hasFile = (file) => existsSync(join(dir, file))
  if (!hasFile('package.json')) throw new Error(`No package.json in "${dir}".`)

  const packageJson = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const { packageManager, lockfile } = detectPackageManager(packageJson, hasFile)
  const nodeVersionFile = detectNodeVersionFile(hasFile)

  const outputs = {
    'package-manager': packageManager,
    lockfile: join(dir, lockfile),
    'package-json': join(dir, 'package.json'),
    'node-version-file': join(dir, nodeVersionFile),
  }
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
  console.log(`Detected ${packageManager} (${outputs.lockfile}), Node version from ${outputs['node-version-file']}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.log(`::error title=setup::${escapeCommand(error.message)}`)
    process.exit(1)
  }
}

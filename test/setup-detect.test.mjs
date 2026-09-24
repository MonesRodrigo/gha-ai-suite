import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectNodeVersionFile, detectPackageManager } from '../actions/setup/detect.mjs'

const files = (...names) => (name) => names.includes(name)

test('uses the declared packageManager', () => {
  const result = detectPackageManager({ packageManager: 'pnpm@11.1.3' }, files('pnpm-lock.yaml'))
  assert.deepEqual(result, { packageManager: 'pnpm', lockfile: 'pnpm-lock.yaml' })
})

test('falls back to the only lockfile for npm', () => {
  assert.equal(detectPackageManager({}, files('package-lock.json')).packageManager, 'npm')
})

test('the declared manager wins over stray lockfiles', () => {
  const result = detectPackageManager({ packageManager: 'npm@10.9.4' }, files('package-lock.json', 'pnpm-lock.yaml'))
  assert.equal(result.packageManager, 'npm')
})

test('rejects ambiguous lockfiles without a declaration', () => {
  assert.throws(() => detectPackageManager({}, files('package-lock.json', 'pnpm-lock.yaml')), /several lockfiles/)
})

test('rejects a project without a lockfile', () => {
  assert.throws(() => detectPackageManager({}, files()), /No lockfile/)
})

test('rejects a declared manager whose lockfile is missing', () => {
  assert.throws(() => detectPackageManager({ packageManager: 'pnpm@11.1.3' }, files()), /pnpm-lock.yaml is missing/)
})

test('requires pnpm projects to pin their version', () => {
  assert.throws(() => detectPackageManager({}, files('pnpm-lock.yaml')), /must declare "packageManager"/)
})

test('rejects unsupported managers', () => {
  assert.throws(() => detectPackageManager({ packageManager: 'bun@1.0.0' }, files()), /Unsupported/)
  assert.throws(() => detectPackageManager({}, files('yarn.lock')), /Yarn is not supported/)
})

test('does not treat prototype keys as package managers', () => {
  assert.throws(() => detectPackageManager({ packageManager: 'constructor@1' }, files()), /Unsupported/)
})

test('prefers .nvmrc, then other version files, then package.json', () => {
  assert.equal(detectNodeVersionFile(files('.nvmrc', '.node-version')), '.nvmrc')
  assert.equal(detectNodeVersionFile(files('.tool-versions')), '.tool-versions')
  assert.equal(detectNodeVersionFile(files()), 'package.json')
})

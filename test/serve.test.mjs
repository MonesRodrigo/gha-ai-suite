import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { normalizeBase, resolveRequestPath, startServer } from '../actions/serve/serve.mjs'

test('normalizeBase adds the surrounding slashes', () => {
  assert.equal(normalizeBase(), '/')
  assert.equal(normalizeBase(''), '/')
  assert.equal(normalizeBase('fixture'), '/fixture/')
  assert.equal(normalizeBase('/fixture'), '/fixture/')
  assert.equal(normalizeBase('/a/b/'), '/a/b/')
})

test('normalizeBase rejects traversal and odd characters', () => {
  assert.throws(() => normalizeBase('/../etc/'), /Invalid base path/)
  assert.throws(() => normalizeBase('/a b/'), /Invalid base path/)
  assert.throws(() => normalizeBase('/a?b/'), /Invalid base path/)
})

const root = resolve('/srv/site')

test('maps paths under the base to files under the root', () => {
  assert.deepEqual(resolveRequestPath(root, '/fixture/', '/fixture/about/'), { status: 200, path: join(root, 'about') })
  assert.deepEqual(resolveRequestPath(root, '/', '/assets/app.css?v=1'), { status: 200, path: join(root, 'assets/app.css') })
})

test('redirects the base path without its trailing slash', () => {
  assert.deepEqual(resolveRequestPath(root, '/fixture/', '/fixture'), { status: 301, location: '/fixture/' })
})

test('returns 404 outside the base path', () => {
  assert.equal(resolveRequestPath(root, '/fixture/', '/other/').status, 404)
})

test('never resolves outside the root, whatever the encoding', () => {
  const attempts = [
    '/%2e%2e/%2e%2e/etc/passwd',
    '/..%2f..%2fetc/passwd',
    '/fixture//etc/passwd',
    '/fixture/..%2f..%2f..%2fetc/passwd',
    '/fixture/%2e%2e%2f%2e%2e%2fetc/passwd',
    '/fixture/..\\..\\etc\\passwd',
  ]
  for (const url of attempts) {
    const result = resolveRequestPath(root, '/fixture/', url)
    const escaped = result.status === 200 && !result.path.startsWith(`${root}/`)
    assert.equal(escaped, false, `${url} resolved to ${result.path}`)
  }
  assert.equal(resolveRequestPath(root, '/', '/..%2f..%2fetc/passwd').status, 403)
})

test('rejects malformed encodings and null bytes', () => {
  assert.equal(resolveRequestPath(root, '/', '/%E0%A4%A').status, 400)
  assert.equal(resolveRequestPath(root, '/', '/index.html%00.png').status, 400)
})

let dir
let outside
let origin
let server

before(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'serve-test-')))
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'serve-outside-')))
  mkdirSync(join(dir, 'about'))
  writeFileSync(join(dir, 'index.html'), '<h1>home</h1>')
  writeFileSync(join(dir, 'about', 'index.html'), '<h1>about</h1>')
  writeFileSync(join(dir, '404.html'), '<h1>missing</h1>')
  writeFileSync(join(outside, 'secret.txt'), 'secret')
  symlinkSync(join(outside, 'secret.txt'), join(dir, 'leak.txt'))
  ;({ server, origin } = await startServer({ dir, base: '/fixture/' }))
})

after(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

test('serves index files with the right content type', async () => {
  const res = await fetch(`${origin}/fixture/about/`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/html/)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(await res.text(), '<h1>about</h1>')
})

test('serves the site 404 page with a 404 status', async () => {
  const res = await fetch(`${origin}/fixture/nope/`)
  assert.equal(res.status, 404)
  assert.equal(await res.text(), '<h1>missing</h1>')
})

test('refuses symlinks that point outside the root', async () => {
  const res = await fetch(`${origin}/fixture/leak.txt`)
  assert.equal(res.status, 404)
  assert.doesNotMatch(await res.text(), /secret/)
})

test('only allows GET and HEAD', async () => {
  assert.equal((await fetch(`${origin}/fixture/`, { method: 'POST' })).status, 405)
  assert.equal((await fetch(`${origin}/fixture/`, { method: 'HEAD' })).status, 200)
})

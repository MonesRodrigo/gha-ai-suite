import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  blockingViolations,
  discoverPages,
  isSitemapIndex,
  localFileForUrl,
  parseFailOn,
  parseLocs,
  parseTags,
  renderMarkdown,
  toSarif,
} from '../actions/a11y/a11y.mjs'

const urlset = (...locs) => `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`
const index = (...locs) => `<sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`
const fs = (files) => ({ read: (p) => files[p], exists: (p) => p in files })

test('parseLocs decodes XML entities', () => {
  assert.deepEqual(parseLocs(urlset('https://x.dev/a/?q=1&amp;b=2', ' https://x.dev/b/ ')), [
    'https://x.dev/a/?q=1&b=2',
    'https://x.dev/b/',
  ])
})

test('isSitemapIndex tells indexes from url sets', () => {
  assert.equal(isSitemapIndex(index('https://x.dev/s.xml')), true)
  assert.equal(isSitemapIndex(urlset('https://x.dev/')), false)
})

test('localFileForUrl maps URLs under the base and refuses the rest', () => {
  assert.equal(localFileForUrl('https://x.dev/site/sitemap-0.xml', '/site/'), 'sitemap-0.xml')
  assert.equal(localFileForUrl('https://x.dev/other/sitemap-0.xml', '/site/'), null)
  assert.equal(localFileForUrl('https://x.dev/site/%2e%2e/secret.xml', '/site/'), null)
})

test('discoverPages follows a sitemap index, like Astro produces', () => {
  const files = {
    'dist/sitemap-index.xml': index('https://x.dev/site/sitemap-0.xml'),
    'dist/sitemap-0.xml': urlset('https://x.dev/site/b/', 'https://x.dev/site/', 'https://x.dev/site/b/'),
  }
  assert.deepEqual(discoverPages({ dir: 'dist', base: '/site/', ...fs(files) }), ['/site/', '/site/b/'])
})

test('discoverPages ignores URLs outside the base path', () => {
  const files = { 'dist/sitemap.xml': urlset('https://x.dev/site/', 'https://x.dev/elsewhere/') }
  assert.deepEqual(discoverPages({ dir: 'dist', base: '/site/', ...fs(files) }), ['/site/'])
})

test('discoverPages fails instead of testing nothing', () => {
  assert.throws(() => discoverPages({ dir: 'dist', base: '/', ...fs({}) }), /No sitemap found/)
  const wrongBase = { 'dist/sitemap.xml': urlset('https://x.dev/site/') }
  assert.throws(() => discoverPages({ dir: 'dist', base: '/other/', ...fs(wrongBase) }), /no pages under/)
  const broken = { 'dist/sitemap-index.xml': index('https://x.dev/site/missing.xml') }
  assert.throws(() => discoverPages({ dir: 'dist', base: '/site/', ...fs(broken) }), /not in the build/)
})

test('parseFailOn and parseTags validate their input', () => {
  assert.deepEqual([...parseFailOn('critical, serious')], ['critical', 'serious'])
  assert.throws(() => parseFailOn(''), /fail-on/)
  assert.throws(() => parseFailOn('critical,severe'), /fail-on/)
  assert.deepEqual(parseTags('wcag2a,wcag21aa'), ['wcag2a', 'wcag21aa'])
  assert.throws(() => parseTags('wcag2a;rm -rf'), /Invalid axe tags/)
})

const violation = (id, impact) => ({ id, impact, help: `${id} help`, helpUrl: `https://dequeuniversity.com/${id}`, nodes: [{}] })
const results = [
  { path: '/site/', violations: [violation('label', 'critical'), violation('region', 'moderate')] },
  { path: '/site/b/', violations: [], error: 'HTTP 404' },
]
const failOn = new Set(['critical', 'serious'])

test('blockingViolations only keeps the selected impacts', () => {
  assert.deepEqual(blockingViolations(results[0].violations, failOn).map((v) => v.id), ['label'])
})

test('toSarif maps impacts to levels and reports load failures', () => {
  const sarif = toSarif(results, failOn)
  const levels = Object.fromEntries(sarif.runs[0].results.map((r) => [r.ruleId, r.level]))
  assert.deepEqual(levels, { label: 'error', region: 'warning', 'page-load': 'error' })
  assert.equal(sarif.version, '2.1.0')
})

test('renderMarkdown counts failing pages', () => {
  assert.match(renderMarkdown(results, failOn), /2 page\(s\) tested, 2 failing/)
})

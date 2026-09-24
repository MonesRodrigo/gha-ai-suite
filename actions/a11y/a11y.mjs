import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeBase } from '../serve/serve.mjs'

const SITEMAPS = ['sitemap-index.xml', 'sitemap.xml', 'sitemap-0.xml']
const IMPACTS = ['critical', 'serious', 'moderate', 'minor']
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export const parseList = (value = '') =>
  String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export function parseFailOn(value) {
  const levels = parseList(value)
  const unknown = levels.filter((level) => !IMPACTS.includes(level))
  if (!levels.length || unknown.length) throw new Error(`fail-on must list impacts from ${IMPACTS.join(', ')}; got "${value}".`)
  return new Set(levels)
}

export function parseTags(value) {
  const tags = parseList(value)
  if (!tags.length || tags.some((tag) => !/^[A-Za-z0-9.-]+$/.test(tag))) throw new Error(`Invalid axe tags "${value}".`)
  return tags
}

export const isSitemapIndex = (xml) => /<sitemapindex[\s>]/.test(xml)

export function parseLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(([, loc]) =>
    loc.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name]),
  )
}

const pathnameOf = (loc) => {
  try {
    return new URL(loc).pathname
  } catch {
    return null
  }
}

/** Path of a sitemap URL inside the build directory, or null when it is outside `base`. */
export function localFileForUrl(loc, base) {
  const pathname = pathnameOf(loc)
  if (!pathname?.startsWith(base)) return null
  let relative
  try {
    relative = decodeURIComponent(pathname.slice(base.length))
  } catch {
    return null
  }
  return relative.split('/').includes('..') ? null : relative
}

/**
 * Every page URL path listed in the build's sitemap, following one level of
 * sitemap index. Throws instead of returning an empty list, so a missing or
 * misconfigured sitemap can never produce a green run that tested nothing.
 */
export function discoverPages({ dir, base, read, exists, sitemap = '' }) {
  const entry = sitemap || SITEMAPS.find((file) => exists(join(dir, file)))
  if (!entry || !exists(join(dir, entry))) {
    throw new Error(`No sitemap found in "${dir}" (looked for ${sitemap || SITEMAPS.join(', ')}). Every page must be discoverable to be tested.`)
  }

  const xml = read(join(dir, entry))
  const locs = isSitemapIndex(xml)
    ? parseLocs(xml).flatMap((loc) => {
        const file = localFileForUrl(loc, base)
        if (!file || !exists(join(dir, file))) throw new Error(`Sitemap index lists ${loc}, which is not in the build under "${base}".`)
        return parseLocs(read(join(dir, file)))
      })
    : parseLocs(xml)

  const pages = [...new Set(locs.map(pathnameOf).filter((path) => path?.startsWith(base)))].sort()
  if (!pages.length) throw new Error(`The sitemap lists no pages under "${base}". Check the base-path input.`)
  return pages
}

export const blockingViolations = (violations, failOn) => violations.filter((v) => failOn.has(v.impact))

export function toSarif(results, failOn) {
  const rules = new Map()
  const sarifResults = []
  const location = (path) => [{ physicalLocation: { artifactLocation: { uri: path }, region: { startLine: 1 } } }]

  for (const { path, violations, error } of results) {
    if (error) {
      rules.set('page-load', { id: 'page-load', shortDescription: { text: 'Page could not be loaded' } })
      sarifResults.push({ ruleId: 'page-load', level: 'error', message: { text: error }, locations: location(path) })
    }
    for (const v of violations) {
      rules.set(v.id, { id: v.id, shortDescription: { text: v.help }, helpUri: v.helpUrl })
      sarifResults.push({
        ruleId: v.id,
        level: failOn.has(v.impact) ? 'error' : 'warning',
        message: { text: `${v.help} (${v.nodes.length} element(s), impact: ${v.impact}).` },
        locations: location(path),
      })
    }
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'axe-core', informationUri: 'https://github.com/dequelabs/axe-core', rules: [...rules.values()] } }, results: sarifResults }],
  }
}

export function renderMarkdown(results, failOn) {
  const rows = results.map(({ path, violations, error }) => {
    const blocking = blockingViolations(violations, failOn).length
    const verdict = error ? `load failed: ${error}` : blocking ? 'fail' : 'pass'
    return `| \`${path}\` | ${blocking} | ${violations.length - blocking} | ${verdict} |`
  })
  const failed = results.filter((r) => r.error || blockingViolations(r.violations, failOn).length).length
  return [
    '### Accessibility (axe)',
    '',
    `${results.length} page(s) tested, ${failed} failing. Blocking impacts: ${[...failOn].join(', ')}.`,
    '',
    '| Page | Blocking | Other | Result |',
    '| :-- | --: | --: | :-- |',
    ...rows,
    '',
  ].join('\n')
}

const escapeCommand = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

async function main() {
  const dir = process.env.A11Y_DIR || 'dist'
  const base = normalizeBase(process.env.A11Y_BASE)
  const origin = new URL(process.env.A11Y_ORIGIN).origin
  const tags = parseTags(process.env.A11Y_TAGS)
  const failOn = parseFailOn(process.env.A11Y_FAIL_ON)
  const pages = discoverPages({
    dir,
    base,
    sitemap: process.env.A11Y_SITEMAP,
    exists: existsSync,
    read: (path) => readFileSync(path, 'utf8'),
  })
  console.log(`Testing ${pages.length} page(s) from the sitemap.`)

  const { chromium } = await import('playwright')
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  const browser = await chromium.launch()
  const results = []
  try {
    const context = await browser.newContext()
    for (const path of pages) {
      const page = await context.newPage()
      try {
        const response = await page.goto(`${origin}${path}`, { waitUntil: 'load' })
        if (!response || response.status() >= 400) {
          results.push({ path, violations: [], error: `HTTP ${response?.status() ?? 'no response'}` })
          continue
        }
        const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze()
        results.push({ path, violations })
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
  }

  writeFileSync(process.env.A11Y_SARIF || 'a11y.sarif', JSON.stringify(toSarif(results, failOn), null, 2))
  const report = renderMarkdown(results, failOn)
  console.log(report)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`)

  let failing = 0
  for (const { path, violations, error } of results) {
    if (error) {
      failing++
      console.log(`::error title=a11y page-load::${escapeCommand(`${path}: ${error}`)}`)
    }
    for (const v of blockingViolations(violations, failOn)) {
      failing++
      console.log(`::error title=a11y ${escapeCommand(v.id)}::${escapeCommand(`${path}: ${v.help} (${v.nodes.length} element(s))`)}`)
    }
  }
  if (failing) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.log(`::error title=a11y::${escapeCommand(error.message)}`)
    process.exit(1)
  })
}

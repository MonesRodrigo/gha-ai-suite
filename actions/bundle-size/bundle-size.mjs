import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

// HTML grows with every content page, so it is reported but kept out of the budget.
const BUDGETED = ['.js', '.mjs', '.css']
const REPORTED = [...BUDGETED, '.html']

/** Parse a positive budget in KB. `Number('abc')` is NaN, which would silently disable the gate. */
export function parseBudget(value) {
  const budget = Number(value)
  if (value === '' || value == null || !Number.isFinite(budget) || budget <= 0) {
    throw new Error(`budget-kb must be a positive number, got "${value}".`)
  }
  return budget
}

export function collect(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collect(path))
    else if (REPORTED.includes(extname(entry.name).toLowerCase())) files.push(path)
  }
  return files
}

/** Aggregate gzipped sizes per category and compare budgeted assets with the budget. */
export function summarize(files, budgetKb) {
  const totals = { js: 0, css: 0, html: 0 }
  for (const { ext, gz } of files) {
    if (ext === '.css') totals.css += gz
    else if (ext === '.html') totals.html += gz
    else totals.js += gz
  }
  const assets = totals.js + totals.css
  const top = files
    .filter((file) => BUDGETED.includes(file.ext))
    .sort((a, b) => b.gz - a.gz)
    .slice(0, 5)
  return { totals, assets, budgetBytes: budgetKb * 1024, overBudget: assets > budgetKb * 1024, top }
}

const kb = (bytes) => (bytes / 1024).toFixed(1)

export function renderMarkdown(summary, budgetKb) {
  return [
    '### Bundle size (gzip)',
    '',
    '| Category | Size |',
    '| :-- | --: |',
    `| JS | ${kb(summary.totals.js)} KB |`,
    `| CSS | ${kb(summary.totals.css)} KB |`,
    `| HTML (not budgeted) | ${kb(summary.totals.html)} KB |`,
    `| **JS + CSS** | **${kb(summary.assets)} KB / ${budgetKb} KB** |`,
    '',
    summary.overBudget ? '**Over budget.**' : 'Within budget.',
    '',
    ...(summary.top.length ? ['Heaviest files:', '', ...summary.top.map((f) => `- \`${f.path}\` ${kb(f.gz)} KB`), ''] : []),
  ].join('\n')
}

const escapeCommand = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

function main() {
  const dir = process.env.BUNDLE_DIR || 'dist'
  const budgetKb = parseBudget(process.env.BUNDLE_BUDGET_KB)
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Directory "${dir}" does not exist.`)

  const files = collect(dir).map((path) => ({
    path: relative(dir, path),
    ext: extname(path).toLowerCase(),
    gz: gzipSync(readFileSync(path)).length,
  }))
  const summary = summarize(files, budgetKb)
  const report = renderMarkdown(summary, budgetKb)

  console.log(report)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`)
  if (summary.overBudget) {
    console.log(`::error title=bundle-size::JS + CSS is ${kb(summary.assets)} KB, over the ${budgetKb} KB budget.`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.log(`::error title=bundle-size::${escapeCommand(error.message)}`)
    process.exit(1)
  }
}

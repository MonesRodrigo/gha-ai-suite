import { cpSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// Mirrors a GitHub Pages project site: every URL lives under a base path.
const SITE = 'https://example.com'
const BASE = '/fixture/'

rmSync('dist', { recursive: true, force: true })
cpSync('src', 'dist', { recursive: true })

const pages = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name === 'index.html') pages.push(relative('dist', dir).split(sep).join('/'))
  }
}
walk('dist')

const urls = pages
  .sort()
  .map((page) => `<url><loc>${SITE}${BASE}${page ? `${page}/` : ''}</loc></url>`)
  .join('')
writeFileSync(
  join('dist', 'sitemap-0.xml'),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`,
)
console.log(`Built ${pages.length} page(s) into dist/.`)

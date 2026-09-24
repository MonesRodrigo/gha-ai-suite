import { appendFileSync, createReadStream, existsSync, realpathSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
}

/** Normalize a base path to `/segment/` form, rejecting anything unusual. */
export function normalizeBase(base = '/') {
  const trimmed = String(base).trim() || '/'
  if (!/^[A-Za-z0-9._~\-/]+$/.test(trimmed) || trimmed.split('/').includes('..')) {
    throw new Error(`Invalid base path "${base}".`)
  }
  const leading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return leading.endsWith('/') ? leading : `${leading}/`
}

const inside = (root, path) => path === root || path.startsWith(root + sep)

/**
 * Map a request URL to a path under `root`. Returns an HTTP-like result so the
 * routing rules stay testable without a running server.
 */
export function resolveRequestPath(root, base, rawUrl) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname)
  } catch {
    return { status: 400 }
  }
  if (pathname.includes('\0')) return { status: 400 }
  if (`${pathname}/` === base) return { status: 301, location: base }
  if (!pathname.startsWith(base)) return { status: 404 }

  const target = resolve(root, pathname.slice(base.length))
  if (!inside(root, target)) return { status: 403 }
  return { status: 200, path: target }
}

// Resolves directories to index.html and refuses symlinks that escape the root.
function findFile(root, target) {
  try {
    const path = statSync(target).isDirectory() ? join(target, 'index.html') : target
    const real = realpathSync(path)
    return inside(root, real) && statSync(real).isFile() ? real : null
  } catch {
    return null
  }
}

export function startServer({ dir, base = '/', host = '127.0.0.1', port = 0 }) {
  const root = realpathSync(resolve(dir))
  const normalizedBase = normalizeBase(base)

  const server = createServer((req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end()
      return
    }

    const result = resolveRequestPath(root, normalizedBase, req.url)
    if (result.status === 301) {
      res.writeHead(301, { ...headers, Location: result.location }).end()
      return
    }

    let status = result.status
    let file = status === 200 ? findFile(root, result.path) : null
    if (!file) {
      status = status === 200 ? 404 : status
      const notFound = join(root, '404.html')
      file = status === 404 && existsSync(notFound) ? findFile(root, notFound) : null
    }
    if (!file) {
      res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end(`${status}\n`)
      return
    }

    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
    res.writeHead(status, { ...headers, 'Content-Type': type, 'Content-Length': statSync(file).size })
    if (req.method === 'HEAD') res.end()
    else createReadStream(file).pipe(res)
  })

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const { port: actualPort } = server.address()
      resolvePromise({ server, origin: `http://${host}:${actualPort}`, base: normalizedBase })
    })
  })
}

const escapeCommand = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

async function main() {
  const port = Number(process.env.SERVE_PORT ?? 4321)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port "${process.env.SERVE_PORT}".`)
  const base = normalizeBase(process.env.SERVE_BASE)

  // `--url` validates the inputs and prints the address without serving.
  if (process.argv.includes('--url')) {
    const dir = process.env.SERVE_DIR || 'dist'
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`Directory "${dir}" does not exist.`)
    const origin = `http://127.0.0.1:${port}`
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `origin=${origin}\nurl=${origin}${base}\n`)
    console.log(`${origin}${base}`)
    return
  }

  const { origin } = await startServer({ dir: process.env.SERVE_DIR || 'dist', base, port })
  console.log(`Serving ${process.env.SERVE_DIR || 'dist'} at ${origin}${base}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.log(`::error title=serve::${escapeCommand(error.message)}`)
    process.exit(1)
  })
}

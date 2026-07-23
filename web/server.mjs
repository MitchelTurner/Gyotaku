/**
 * Production static server for Railway.
 * - Serves Vite `dist/` (SPA fallback)
 * - Proxies `/api/*` → API_PROXY_TARGET (strips `/api` prefix)
 */
import { createServer } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { URL } from 'node:url'

const port = Number(process.env.PORT || 4173)
const root = join(process.cwd(), 'dist')
const apiTarget = (
  process.env.API_PROXY_TARGET || 'https://gyotaku-api.up.railway.app'
).replace(/\/$/, '')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

async function sendFile(res, filePath, status = 200) {
  const data = await readFile(filePath)
  res.writeHead(status, {
    'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': filePath.endsWith('index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  })
  res.end(data)
}

function proxyApi(req, res) {
  const incoming = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  // /api/health → /health on the API
  const upstreamPath = incoming.pathname.replace(/^\/api/, '') || '/'
  const target = new URL(apiTarget)
  const upstreamUrl = new URL(
    upstreamPath + incoming.search,
    `${target.protocol}//${target.host}`,
  )

  const lib = upstreamUrl.protocol === 'https:' ? httpsRequest : httpRequest
  const headers = { ...req.headers, host: upstreamUrl.host }
  delete headers['connection']

  const proxyReq = lib(
    {
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || (upstreamUrl.protocol === 'https:' ? 443 : 80),
      path: upstreamUrl.pathname + upstreamUrl.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
      proxyRes.pipe(res)
    },
  )

  proxyReq.on('error', (err) => {
    console.error('api proxy error', apiTarget, err.message)
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
    }
    res.end(
      JSON.stringify({
        error: 'Bad gateway',
        message: `API proxy failed (${apiTarget}): ${err.message}`,
      }),
    )
  })

  req.pipe(proxyReq)
}

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0] || '/')

    if (urlPath === '/api' || urlPath.startsWith('/api/')) {
      proxyApi(req, res)
      return
    }

    const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
    let filePath = join(root, safe === '/' ? 'index.html' : safe)

    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('forbidden')
      return
    }

    try {
      const st = await stat(filePath)
      if (st.isDirectory()) filePath = join(filePath, 'index.html')
      await sendFile(res, filePath)
      return
    } catch {
      await sendFile(res, join(root, 'index.html'))
    }
  } catch (err) {
    console.error(err)
    if (!res.headersSent) res.writeHead(500)
    res.end('error')
  }
}).listen(port, '0.0.0.0', () => {
  console.log(
    `gyotaku web listening on 0.0.0.0:${port} (api → ${apiTarget})`,
  )
})

/** Production static server — binds Railway PORT on 0.0.0.0. */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

const port = Number(process.env.PORT || 4173)
const root = join(process.cwd(), 'dist')

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

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0] || '/')
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
      // SPA fallback
      await sendFile(res, join(root, 'index.html'))
    }
  } catch (err) {
    console.error(err)
    res.writeHead(500).end('error')
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`gyotaku web listening on 0.0.0.0:${port}`)
})

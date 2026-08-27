import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createPreviewApp } from './app.js'

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const app = createPreviewApp({
  source: './content/index.md',
})

const server = createServer((req, res) => {
  void handleNodeRequest(req, res)
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Typeset preview: http://127.0.0.1:${port}`)
})

async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const response = await app.fetch(incomingToRequest(req))
    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.appendHeader(key, value)
    })
    const body = Buffer.from(await response.arrayBuffer())
    res.end(body)
  } catch (error) {
    console.error('[kumihan] Unexpected server error:', error)
    res.statusCode = 500
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Internal Server Error')
  }
}

function incomingToRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? '127.0.0.1'
  const url = `http://${host}${req.url ?? '/'}`
  const headers = new Headers()

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (key.toLowerCase() === 'host') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item)
      }
    } else {
      headers.set(key, value)
    }
  }

  return new Request(url, {
    method: req.method,
    headers,
  })
}

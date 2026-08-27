import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import type { Hono } from 'hono'

export function createNodeServer(app: Hono): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    void dispatchNodeRequest(req, res, async (request) => app.fetch(request))
  })
}

export async function dispatchNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  fetchImpl: (request: Request) => Promise<Response>,
): Promise<void> {
  try {
    const host = req.headers.host ?? '127.0.0.1'
    const method = req.method ?? 'GET'
    const response = await fetchImpl(new Request(`http://${host}${req.url ?? '/'}`, { method }))
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.error('[kumihan] Unexpected server error:', error)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    }
    res.end('Internal Server Error')
  }
}

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import type { Hono } from 'hono'

export function createNodeServer(app: Hono): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    void dispatchNodeRequest(req, res, async (request) => app.fetch(request))
  })
}

// Host ヘッダはクライアントが自由に決められるので、そのまま URL に
// 埋め込むと `evil.com/x?` のような値でリクエスト URL のパスや
// クエリを差し替えられます。素の authority（ホストと任意のポート）
// でなければ採用しません。
const AUTHORITY =
  /^(?:\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*)(?::(\d{1,5}))?$/

export function safeHost(host: string | undefined): string {
  if (host === undefined || host.length > 255) {
    return '127.0.0.1'
  }
  const match = AUTHORITY.exec(host)
  if (!match) {
    return '127.0.0.1'
  }
  // 桁数だけでは 65535 を超えるポートを通してしまい、URL の構築が例外に
  // なって 500 を返します。範囲まで見て、既定値へ落とします。
  const port = match[1]
  if (port !== undefined && Number(port) > 65535) {
    return '127.0.0.1'
  }
  return host
}

export async function dispatchNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  fetchImpl: (request: Request) => Promise<Response>,
): Promise<void> {
  try {
    const host = safeHost(req.headers.host)
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

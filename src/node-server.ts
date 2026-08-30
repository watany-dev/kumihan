import { createServer, type OutgoingHttpHeaders } from 'node:http'

import type { Hono } from 'hono'

import { AUTHORITY, isAllowedHost, LOOPBACK_HOST_POLICY, type HostPolicy } from './security/host.js'

export function createNodeServer(
  app: Hono,
  hostPolicy: HostPolicy = LOOPBACK_HOST_POLICY,
): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    void dispatchNodeRequest(req, res, async (request) => app.fetch(request), hostPolicy)
  })
}

export function safeHost(host: string | undefined): string {
  if (host === undefined || host.length > 255) {
    return '127.0.0.1'
  }
  if (!AUTHORITY.test(host)) {
    return '127.0.0.1'
  }
  // 素の authority に見えても URL が受け付けない値が残ります。範囲外の
  // ポート（`:99999`）のほか、末尾のラベルが数字の名前は IPv4 として
  // 解釈されるため `999.999.999.999` や `a.99999`、`09` も通りません。
  // そのまま URL に埋めると例外になり 500 を返してしまうので、
  // 実際に組み立てて確かめ、通らなければ既定値へ落とします。
  if (!URL.canParse(`http://${host}/`)) {
    return '127.0.0.1'
  }
  return host
}

// リクエストターゲットは `/path` だけではありません。HTTP/1.1 は
// `GET http://example.com/a`（absolute-form）と `OPTIONS *`（asterisk-form）も
// 認めていて、Node はどちらも req.url にそのまま入れてきます。`/` で
// 始まらない値を authority の後ろに繋ぐと、URL のホストが変わったり
// （`http://127.0.0.1` + `*` → ホスト `127.0.0.1*`）、そもそも組み立てに
// 失敗して 500 になります。パスだけを取り出して origin-form に直します。
export function safeRequestTarget(target: string | undefined): string {
  if (target === undefined || target.length === 0) {
    return '/'
  }
  if (target.startsWith('/')) {
    return target
  }
  // absolute-form。ホストは Host ヘッダ側で決めるので、パスとクエリだけ使う。
  if (URL.canParse(target)) {
    const url = new URL(target)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return `${url.pathname}${url.search}`
    }
  }
  // asterisk-form（`OPTIONS *`）と、それ以外の解釈できない形。
  return '/'
}

/**
 * listen が失敗したときに出す一行の説明です。
 *
 * `server.listen` の失敗は 'error' イベントで届きます。受け取り手が居ないと
 * Node はそのまま例外にするので、使えないホスト名や埋まっているポートを
 * 指定しただけで、内部のスタックと errno が端末に出てしまいます。打ち間違いは
 * 普通に起きるので、何が起きたかだけを短く伝えます。
 */
export function describeListenError(error: unknown, host: string, port: number): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  const where = `${host}:${port}`
  if (code === 'EADDRINUSE') return `ポートが使用中です: ${where}`
  if (code === 'EACCES') return `ポートを開けませんでした（権限がありません）: ${where}`
  if (code === 'EADDRNOTAVAIL') return `この端末に無いアドレスです: ${host}`
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `ホスト名を解決できません: ${host}`
  const detail = error instanceof Error ? error.message : String(error)
  return `プレビューを開始できませんでした: ${where} (${detail})`
}

// fetch の Request は CONNECT・TRACE・TRACK を組み立てられません（仕様が
// 禁じているメソッドです）。Node の HTTP サーバはこれらをそのまま渡してくる
// ので、素直に Request へ流すと例外になり、プレビューが 500 と内部エラーの
// ログを返してしまいます。プロキシ用のメソッドで原稿を返す理由も無いので、
// Request を作る前に 405 で断ります。
const FORBIDDEN_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK'])

// 断る理由を書いておかないと、Codespaces や LAN から開いた人には
// 「なぜか 403 が返る」だけになります。逃げ道の名前をそのまま出します。
const FORBIDDEN_HOST = [
  'Forbidden host.',
  '',
  'kumihan は Host ヘッダが自分の名前のときだけ原稿を返します',
  '（DNS リバインディング対策）。この名前で開きたいときは',
  'KUMIHAN_ALLOWED_HOSTS=example.com のように許可してください。',
].join('\n')

function isForbiddenMethod(method: string): boolean {
  return FORBIDDEN_METHODS.has(method.toUpperCase())
}

// 受け取るのは Node の req/res のうち、ここで実際に使うところだけです。
// 何を読んで何を書くのかがそのまま型になり、テストからも組み立てられます。
export interface NodeRequestLike {
  headers: { host?: string | undefined }
  method?: string | undefined
  url?: string | undefined
}

export interface NodeResponseLike {
  headersSent: boolean
  statusCode: number
  writeHead(status: number, headers?: OutgoingHttpHeaders): unknown
  setHeader(name: string, value: string): unknown
  end(chunk?: Buffer | string): unknown
}

export async function dispatchNodeRequest(
  req: NodeRequestLike,
  res: NodeResponseLike,
  fetchImpl: (request: Request) => Promise<Response>,
  hostPolicy: HostPolicy = LOOPBACK_HOST_POLICY,
): Promise<void> {
  try {
    // 原稿を返す前に、名乗られたホストが自分の名前かどうかを見ます。
    // 詳しくは src/security/host.ts を参照。
    if (!isAllowedHost(req.headers.host, hostPolicy)) {
      res.writeHead(403, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(FORBIDDEN_HOST)
      return
    }
    const host = safeHost(req.headers.host)
    const method = req.method ?? 'GET'
    if (isForbiddenMethod(method)) {
      res.writeHead(405, {
        'Content-Type': 'text/plain; charset=utf-8',
        Allow: 'GET, HEAD',
      })
      res.end('Method Not Allowed')
      return
    }
    const target = safeRequestTarget(req.url)
    const response = await fetchImpl(new Request(`http://${host}${target}`, { method }))
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

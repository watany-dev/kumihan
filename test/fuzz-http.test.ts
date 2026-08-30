import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { createPreviewApp } from '../src/app.js'
import { dispatchNodeRequest, safeHost, safeRequestTarget } from '../src/node-server.js'

// Host ヘッダとリクエストターゲットはクライアントが自由に決められます。
// v0.1.0 のあとに入った検証（safeHost / safeRequestTarget）を、実際に
// リクエストを組み立てるところまで通して揺さぶります。プレビューは原稿を
// 返すだけなので、どんな値でも 5xx と内部エラーのログを出してはいけません。

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(rand: () => number, values: readonly (string | undefined)[]): string | undefined {
  return values[Math.floor(rand() * values.length)]
}

const HOSTS: (string | undefined)[] = [
  undefined,
  '',
  '127.0.0.1',
  '127.0.0.1:3000',
  'localhost',
  'EXAMPLE.com',
  'evil.example.com/assets/web.css?',
  'user@evil.example.com',
  'example.com#',
  'a b',
  '[::1]',
  '[::1]:3000',
  '999.999.999.999',
  'a.99999',
  '09',
  'x:99999',
  'x:0',
  'x:65535',
  'x:65536',
  '-a.com',
  'a-.com',
  'a..b',
  '.',
  'a'.repeat(300),
  'host:3000:3000',
  'ホスト.jp',
  'xn--n8j6ds53lwwkrqhv28a.jp',
  'a:',
]

const TARGETS: (string | undefined)[] = [
  undefined,
  '',
  '/',
  '//',
  '/index.html',
  '*',
  'http://example.com/a',
  'https://evil.example.com/x?y=1',
  'ftp://x/y',
  'magazine.html',
  '/magazine.html',
  '/web.html',
  '/health',
  '/assets/typeset.css',
  '/assets/web.css',
  '/../../etc/passwd',
  '/%2e%2e/',
  '/a b',
  '/#frag',
  '/?q=1',
  '/'.repeat(200),
  '/a?b#c',
  'javascript:alert(1)',
  '/a%00b',
  '/汉字',
  `/${'x'.repeat(5000)}`,
]

const METHODS: (string | undefined)[] = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'DELETE',
  'OPTIONS',
  'PATCH',
  'TRACE',
  'CONNECT',
  'TRACK',
  'trace',
  'FOO',
  undefined,
]

class RecordingResponse {
  statusCode = 200
  headersSent = false
  headers: Record<string, unknown> = {}
  body: unknown = undefined
  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.statusCode = status
    this.headersSent = true
    if (headers) this.headers = headers
    return this
  }
  setHeader(name: string, value: unknown): void {
    this.headers[name] = value
  }
  write(chunk: unknown): this {
    this.body = chunk
    return this
  }
  end(chunk?: unknown): this {
    if (chunk !== undefined) this.body = chunk
    return this
  }
}

describe('http fuzzing', () => {
  it('never answers with a 5xx, whatever the client sends', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const logged: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    }

    try {
      for (let seed = 1; seed <= 2000; seed += 1) {
        const rand = mulberry32(seed * 2654435761)
        const host = pick(rand, HOSTS)
        const target = pick(rand, TARGETS)
        const method = pick(rand, METHODS)
        const where = `seed ${seed} / host ${JSON.stringify(host)} target ${JSON.stringify(target)} method ${JSON.stringify(method)}`

        // 組み立て直した URL は必ず解釈できること（ここが崩れると 500 になる）。
        const safe = `http://${safeHost(host)}${safeRequestTarget(target)}`
        assert.ok(URL.canParse(safe), `${where}: URL を組み立てられない ${safe}`)

        const res = new RecordingResponse()
        logged.length = 0
        await dispatchNodeRequest(
          { headers: { host }, method, url: target },
          res,
          async (request) => app.fetch(request),
        )
        assert.ok(res.statusCode < 500, `${where}: status ${res.statusCode}`)
        assert.deepEqual(logged, [], `${where}: 内部エラーを記録した`)
      }
    } finally {
      console.error = original
    }
  })

  it('never lets the request target move the host', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const rand = mulberry32(seed * 40503)
      const host = pick(rand, HOSTS)
      const target = pick(rand, TARGETS)
      const safe = safeHost(host)
      const url = new URL(`http://${safe}${safeRequestTarget(target)}`)
      assert.equal(
        url.host,
        new URL(`http://${safe}/`).host,
        `seed ${seed} / host ${JSON.stringify(host)} target ${JSON.stringify(target)}`,
      )
    }
  })
})

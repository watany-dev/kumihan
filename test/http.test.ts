import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vite-plus/test'

import { createPreviewApp } from '../src/app.js'
import {
  createNodeServer,
  describeListenError,
  dispatchNodeRequest,
  safeHost,
  safeRequestTarget,
} from '../src/node-server.js'

function assertSecurityHeaders(headers: Headers): void {
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(headers.get('X-Frame-Options'), 'DENY')
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer')
  // プレビューは自動リロードのスクリプト 1 本と EventSource だけ 'self' で
  // 通します。インライン・属性のスクリプトは通しません。
  assert.match(headers.get('Content-Security-Policy') ?? '', /default-src 'none'/)
  assert.match(headers.get('Content-Security-Policy') ?? '', /script-src 'self'/)
  assert.match(headers.get('Content-Security-Policy') ?? '', /script-src-attr 'none'/)
  assert.match(headers.get('Content-Security-Policy') ?? '', /connect-src 'self'/)
  assert.match(headers.get('Content-Security-Policy') ?? '', /style-src 'self'/)
  assert.match(headers.get('Content-Security-Policy') ?? '', /img-src 'self' https: http:/)
  assert.equal(headers.get('Cross-Origin-Resource-Policy'), 'same-origin')
  assert.match(headers.get('Permissions-Policy') ?? '', /camera=\(\)/)
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try {
    await run(address.port)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

function failingBodyResponse(): Response {
  return new Response(
    new ReadableStream({
      pull(controller) {
        controller.error(new Error('boom'))
      },
    }),
  )
}

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
  write(chunk: Uint8Array | string): this {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    this.body = typeof this.body === 'string' ? this.body + text : text
    return this
  }
  end(chunk?: unknown): this {
    if (typeof chunk === 'string' || chunk instanceof Uint8Array) this.write(chunk)
    return this
  }
}

describe('preview security headers', () => {
  it('sets security headers on every preview route', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const paths = [
      '/',
      '/magazine.html',
      '/magazine',
      '/web.html',
      '/web',
      '/diff.html',
      '/diff',
      '/magazine-diff.html',
      '/magazine-diff',
      '/web-diff.html',
      '/web-diff',
      '/health',
      '/assets/typeset.css',
      '/assets/web.css',
      '/missing.png',
    ]
    const responses = []
    for (const path of paths) {
      responses.push(await app.request(path))
    }
    for (const res of responses) {
      assertSecurityHeaders(res.headers)
    }
    assert.equal(responses.length, 15)
  })

  it('sets security headers on error pages', async () => {
    const app = createPreviewApp({ source: './content/does-not-exist.md' })
    const res = await app.request('/')
    assert.equal(res.status, 404)
    assertSecurityHeaders(res.headers)
    const html = await res.text()
    assert.match(html, /http-equiv="Content-Security-Policy"/)
    assert.match(html, /script-src 'self'/)
    assert.match(html, /connect-src 'self'/)
    assert.equal(html.includes('frame-ancestors'), false)
  })
})

describe('preview app errors', () => {
  it('uses the default source when config is omitted', async () => {
    const app = createPreviewApp()
    const res = await app.request('/')
    assert.equal(res.status, 200)
  })

  it('returns 500 without leaking filesystem details', async () => {
    const app = createPreviewApp({ source: './src' })
    const res = await app.request('/')
    assert.equal(res.status, 500)
    const html = await res.text()
    assert.match(html, /読み込みに失敗しました/)
    assert.equal(html.includes('EISDIR'), false)
    assert.equal(html.toLowerCase().includes('stack'), false)
    assertSecurityHeaders(res.headers)
  })
})

describe('node http adapter', () => {
  it('serves the preview app over Node HTTP', async () => {
    const server = createNodeServer(createPreviewApp({ source: './content/index.md' }))
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/health`)
      assert.equal(res.status, 200)
      assert.deepEqual(await res.json(), { ok: true })
      assertSecurityHeaders(res.headers)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  })

  it('streams /events over Node HTTP and cleans up when the page goes away', async () => {
    // SSE は終わらない応答です。貯めてから書く方式では届かないこと、
    // タブが閉じたら接続ごとの監視が片づき、サーバーを閉じられることを
    // 実際の HTTP で確かめます。
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-http-sse-'))
    const file = join(dir, 'index.md')
    await writeFile(file, '# 保存前\n')
    const server = createNodeServer(createPreviewApp({ source: file }))
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const disconnect = new AbortController()
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/events`, {
        signal: disconnect.signal,
      })
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('Content-Type'), 'text/event-stream')
      assert.ok(res.body)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let received = ''
      const deadline = Date.now() + 5000
      await writeFile(file, '# 保存後\n')
      while (!received.includes('data:') && Date.now() < deadline) {
        const race = await Promise.race([
          reader.read(),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000)),
        ])
        if (race === 'timeout' || race.done) break
        received += decoder.decode(race.value, { stream: true })
      }
      assert.match(received, /retry: \d+/)
      assert.match(received, /data: [0-9a-f]{16}/)
    } finally {
      // タブを閉じたのと同じ切れ方。接続と原稿の監視が残っていると
      // close が返らず、このテストはタイムアウトで落ちます。
      disconnect.abort()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns a generic 500 when fetch throws', async () => {
    await withServer(
      (req, res) => {
        void dispatchNodeRequest(req, res, () => Promise.reject(new Error('boom')))
      },
      async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/`)
        assert.equal(res.status, 500)
        assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8')
        assert.equal(await res.text(), 'Internal Server Error')
      },
    )
  })

  it('uses a fallback host and path when the request omits them', async () => {
    let received: Request | undefined
    await withServer(
      (req, res) => {
        Reflect.deleteProperty(req.headers, 'host')
        req.url = undefined
        req.method = undefined
        void dispatchNodeRequest(req, res, (request) => {
          received = request
          return Promise.resolve(new Response('ok'))
        })
      },
      async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/`)
        assert.equal(res.status, 200)
        assert.equal(await res.text(), 'ok')
      },
    )
    assert.ok(received)
    assert.equal(received.url, 'http://127.0.0.1/')
  })

  it('answers 405 instead of 500 for methods fetch refuses to build', async () => {
    // fetch の Request は CONNECT・TRACE・TRACK を作れません。そのまま渡すと
    // 例外になり、プレビューが 500 と内部エラーのログを返してしまいます。
    for (const method of ['TRACE', 'CONNECT', 'TRACK', 'trace']) {
      const res = new RecordingResponse()
      let called = false
      await dispatchNodeRequest({ headers: { host: '127.0.0.1' }, method, url: '/' }, res, () => {
        called = true
        return Promise.resolve(new Response('ok'))
      })
      assert.equal(res.statusCode, 405, method)
      assert.equal(res.headers['Allow'], 'GET, HEAD')
      assert.equal(res.body, 'Method Not Allowed')
      assert.equal(called, false)
    }
  })

  it('still serves the ordinary methods', async () => {
    for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
      const res = new RecordingResponse()
      await dispatchNodeRequest({ headers: { host: '127.0.0.1' }, method, url: '/' }, res, () =>
        Promise.resolve(new Response('ok')),
      )
      assert.equal(res.statusCode, 200, method)
    }
  })

  it('does not rewrite headers when the response has already started', async () => {
    await withServer(
      (req, res) => {
        void dispatchNodeRequest(req, res, () => Promise.resolve(failingBodyResponse()))
      },
      async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/`)
        assert.equal(await res.text(), 'Internal Server Error')
      },
    )
  })
})

describe('Host header validation', () => {
  it('keeps a plain host, with or without a port', () => {
    assert.equal(safeHost('127.0.0.1:3000'), '127.0.0.1:3000')
    assert.equal(safeHost('localhost'), 'localhost')
    assert.equal(safeHost('kumihan.example.com:8080'), 'kumihan.example.com:8080')
    assert.equal(safeHost('[::1]:3000'), '[::1]:3000')
  })

  it('falls back when the header could rewrite the request URL', () => {
    assert.equal(safeHost('evil.example.com/assets/web.css?'), '127.0.0.1')
    assert.equal(safeHost('user@evil.example.com'), '127.0.0.1')
    assert.equal(safeHost('example.com#'), '127.0.0.1')
    assert.equal(safeHost(''), '127.0.0.1')
    assert.equal(safeHost(undefined), '127.0.0.1')
    assert.equal(safeHost(`${'a'.repeat(256)}.example.com`), '127.0.0.1')
  })

  it('falls back when the port is out of range', () => {
    // 桁数だけを見ていると 65535 超のポートが素通りし、URL の構築が
    // 例外になって 500 を返してしまう。
    assert.equal(safeHost('localhost:65535'), 'localhost:65535')
    assert.equal(safeHost('localhost:65536'), '127.0.0.1')
    assert.equal(safeHost('localhost:99999'), '127.0.0.1')
    assert.equal(safeHost('[::1]:70000'), '127.0.0.1')
  })

  it('falls back for a host the URL parser rejects', () => {
    // 素の authority に見えても、末尾のラベルが数字だと IPv4 として
    // 解釈され、範囲外なら URL の構築が例外になる。そのまま通すと
    // `Host: 999.999.999.999` を送るだけで 500 になってしまう。
    assert.equal(safeHost('999.999.999.999'), '127.0.0.1')
    assert.equal(safeHost('a.99999'), '127.0.0.1')
    assert.equal(safeHost('6553665536'), '127.0.0.1')
    assert.equal(safeHost('09'), '127.0.0.1')
    assert.equal(safeHost('0x100000000'), '127.0.0.1')
    assert.equal(safeHost('[2560]'), '127.0.0.1')
    // 数字を含んでも解釈できる値はそのまま通す。
    assert.equal(safeHost('127.0.0.1'), '127.0.0.1')
    assert.equal(safeHost('2130706433'), '2130706433')
    assert.equal(safeHost('example1.com:3000'), 'example1.com:3000')
  })

  it('refuses a Host header the URL parser rejects, without reading the manuscript', async () => {
    let reached = false
    await withServer(
      (req, res) => {
        req.headers.host = '999.999.999.999'
        void dispatchNodeRequest(req, res, async () => {
          reached = true
          return new Response('ok')
        })
      },
      async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        assert.equal(res.status, 403)
        await res.text()
      },
    )
    assert.equal(reached, false)
  })

  it('answers normally for a Host header with an out-of-range port', async () => {
    let seen = ''
    await withServer(
      (req, res) => {
        req.headers.host = 'localhost:99999'
        void dispatchNodeRequest(req, res, async (request) => {
          seen = new URL(request.url).host
          return new Response('ok')
        })
      },
      async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        assert.equal(res.status, 200)
        assert.equal(await res.text(), 'ok')
        assert.equal(seen, '127.0.0.1')
      },
    )
  })

  it('always returns a host that builds the request URL as intended', () => {
    // Host ヘッダは何でも送れるので、素の authority に見える値を機械的に
    // 作って確かめます。URL が組み立てられること、そしてパスとクエリを
    // 乗っ取られないこと。どちらかが崩れると 500 か経路の差し替えになります。
    const parts = ['a', 'b', '.', ':', '0', '1', '9', '99999', '65536', '255', '256', '0x', 'ff']
    let random = 1
    for (let seed = 1; seed <= 2000; seed += 1) {
      random = (Math.imul(random, 1103515245) + 12345) & 0x7fffffff
      let host = ''
      for (let p = 0; p < 1 + (random % 6); p += 1) {
        random = (Math.imul(random, 1103515245) + 12345) & 0x7fffffff
        host += parts[random % parts.length] ?? ''
      }
      const safe = safeHost(host)
      const url = new URL(`http://${safe}/health?q=1`)
      assert.equal(url.pathname, '/health', `Host: ${host}`)
      assert.equal(url.search, '?q=1', `Host: ${host}`)
      assert.equal(url.username, '', `Host: ${host}`)
    }
  })

  it('normalizes a request target that is not an origin-form path', () => {
    // HTTP/1.1 は `OPTIONS *` と `GET http://example.com/a` も認めていて、
    // Node はどちらも req.url にそのまま入れてくる。`/` で始まらない値を
    // authority の後ろに繋ぐと、ホストが変わるか URL の構築が例外になる。
    assert.equal(safeRequestTarget('/magazine.html?x=1'), '/magazine.html?x=1')
    assert.equal(safeRequestTarget('*'), '/')
    assert.equal(safeRequestTarget(undefined), '/')
    assert.equal(safeRequestTarget(''), '/')
    assert.equal(safeRequestTarget('http://evil.example.com/web.html?x=1'), '/web.html?x=1')
    assert.equal(safeRequestTarget('https://evil.example.com/'), '/')
    // 解釈できない形はトップに落とす。ホスト名の一部にはさせない。
    assert.equal(safeRequestTarget('x'), '/')
    assert.equal(safeRequestTarget('example.com:80'), '/')
    assert.equal(safeRequestTarget('..a[:'), '/')
  })

  it('always builds the request URL from the target as intended', () => {
    // リクエストターゲットも自由に送れるので、機械的に作って確かめます。
    const parts = ['/', '*', '?', '#', '%', '%2e', 'a', '..', ':', '@', '[', ']', 'http://x', '\\']
    const hosts = ['127.0.0.1', 'localhost:3000', '[::1]:3000']
    let random = 7
    for (let seed = 1; seed <= 2000; seed += 1) {
      let target = ''
      for (let p = 0; p < 1 + (random % 5); p += 1) {
        random = (Math.imul(random, 1103515245) + 12345) & 0x7fffffff
        target += parts[random % parts.length] ?? ''
      }
      const safe = safeRequestTarget(target)
      assert.ok(safe.startsWith('/'), `target: ${target} -> ${safe}`)
      for (const host of hosts) {
        const url = new URL(`http://${host}${safe}`)
        assert.equal(url.host, host, `target: ${target}`)
      }
    }
  })

  it('answers normally for an asterisk-form request target', async () => {
    let seen = ''
    await withServer(
      (req, res) => {
        req.url = '*'
        void dispatchNodeRequest(req, res, async (request) => {
          seen = new URL(request.url).pathname
          return new Response('ok')
        })
      },
      async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        assert.equal(res.status, 200)
        assert.equal(await res.text(), 'ok')
      },
    )
    assert.equal(seen, '/')
  })

  it('routes an absolute-form request target by its path', async () => {
    let seen = ''
    await withServer(
      (req, res) => {
        req.url = 'http://evil.example.com/magazine.html'
        void dispatchNodeRequest(req, res, async (request) => {
          const url = new URL(request.url)
          seen = url.pathname
          return new Response('ok')
        })
      },
      async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        assert.equal(res.status, 200)
        await res.text()
      },
    )
    assert.equal(seen, '/magazine.html')
  })

  it('does not let the Host header change the routed path', async () => {
    // 経路の差し替え以前に、他人のドメインを名乗るリクエストは 403 で
    // 断ります（DNS リバインディング対策。test/host-policy.test.ts を参照）。
    let reached = false
    await withServer(
      (req, res) => {
        req.headers.host = 'evil.example.com/magazine.html?'
        void dispatchNodeRequest(req, res, async () => {
          reached = true
          return new Response('ok')
        })
      },
      async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        assert.equal(res.status, 403)
        await res.text()
      },
    )
    assert.equal(reached, false)
  })
})

function errorWithCode(code: string): Error {
  return Object.assign(new Error('boom'), { code })
}

describe('listen errors', () => {
  it('explains why the preview could not start, without a stack trace', () => {
    assert.equal(
      describeListenError(errorWithCode('EADDRINUSE'), '127.0.0.1', 3000),
      'ポートが使用中です: 127.0.0.1:3000',
    )
    assert.equal(
      describeListenError(errorWithCode('EACCES'), '127.0.0.1', 80),
      'ポートを開けませんでした（権限がありません）: 127.0.0.1:80',
    )
    assert.equal(
      describeListenError(errorWithCode('EADDRNOTAVAIL'), '10.0.0.1', 3000),
      'この端末に無いアドレスです: 10.0.0.1',
    )
    assert.equal(
      describeListenError(errorWithCode('ENOTFOUND'), 'nope', 3000),
      'ホスト名を解決できません: nope',
    )
    assert.equal(
      describeListenError(errorWithCode('EAI_AGAIN'), 'nope', 3000),
      'ホスト名を解決できません: nope',
    )
    assert.equal(
      describeListenError(new Error('boom'), '127.0.0.1', 3000),
      'プレビューを開始できませんでした: 127.0.0.1:3000 (boom)',
    )
    assert.equal(
      describeListenError('boom', '127.0.0.1', 3000),
      'プレビューを開始できませんでした: 127.0.0.1:3000 (boom)',
    )
  })
})

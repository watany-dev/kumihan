import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { describe, it } from 'vite-plus/test'

import { createPreviewApp } from '../src/app.js'
import {
  createNodeServer,
  dispatchNodeRequest,
  safeHost,
  safeRequestTarget,
} from '../src/node-server.js'
import { DOCUMENT_CONTENT_SECURITY_POLICY } from '../src/security/headers.js'

function assertSecurityHeaders(headers: Headers): void {
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(headers.get('X-Frame-Options'), 'DENY')
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer')
  assert.match(headers.get('Content-Security-Policy') ?? '', /default-src 'none'/)
  assert.match(headers.get('Content-Security-Policy') ?? '', /script-src 'none'/)
  assert.match(headers.get('Content-Security-Policy') ?? '', /style-src 'self'/)
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

describe('preview security headers', () => {
  it('sets security headers on every preview route', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const paths = [
      '/',
      '/magazine.html',
      '/magazine',
      '/web.html',
      '/web',
      '/health',
      '/assets/typeset.css',
      '/assets/web.css',
    ]
    const responses = []
    for (const path of paths) {
      responses.push(await app.request(path))
    }
    for (const res of responses) {
      assertSecurityHeaders(res.headers)
    }
    assert.equal(responses.length, 8)
  })

  it('sets security headers on error pages', async () => {
    const app = createPreviewApp({ source: './content/does-not-exist.md' })
    const res = await app.request('/')
    assert.equal(res.status, 404)
    assertSecurityHeaders(res.headers)
    const html = await res.text()
    assert.match(html, new RegExp(DOCUMENT_CONTENT_SECURITY_POLICY.replaceAll(';', '\\;')))
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

  it('answers normally for a Host header the URL parser rejects', async () => {
    let seen = ''
    await withServer(
      (req, res) => {
        req.headers.host = '999.999.999.999'
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
    let seen = ''
    await withServer(
      (req, res) => {
        req.headers.host = 'evil.example.com/magazine.html?'
        void dispatchNodeRequest(req, res, async (request) => {
          seen = new URL(request.url).pathname
          return new Response('ok')
        })
      },
      async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        await res.text()
      },
    )
    assert.equal(seen, '/health')
  })
})

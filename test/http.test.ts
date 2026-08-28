import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { describe, it } from 'vite-plus/test'

import { createPreviewApp } from '../src/app.js'
import { createNodeServer, dispatchNodeRequest, safeHost } from '../src/node-server.js'
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

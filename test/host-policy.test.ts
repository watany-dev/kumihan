import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { dispatchNodeRequest } from '../src/node-server.js'
import { createHostPolicy, isAllowedHost, LOOPBACK_HOST_POLICY } from '../src/security/host.js'

// DNS リバインディングは、攻撃者のドメインを 127.0.0.1 に差し替えてから、
// そのページの JavaScript で原稿を読み出す攻撃です。ブラウザから見た生成元は
// 攻撃者のドメインのままなので、CSP も CORS も CORP も効きません。Host が
// 自分の名前かどうかを見るのが唯一の防ぎ方です。

describe('host policy', () => {
  it('通す: 名前ではないので付け替えられないもの', () => {
    for (const host of [
      '127.0.0.1',
      '127.0.0.1:3000',
      '[::1]',
      '[::1]:3000',
      '192.168.1.5:3000',
      'localhost',
      'localhost:3000',
      'localhost:99999',
      'kumihan.localhost:3000',
      'LOCALHOST:3000',
    ]) {
      assert.equal(isAllowedHost(host, LOOPBACK_HOST_POLICY), true, host)
    }
  })

  it('断る: 他人のドメインを名乗るリクエスト', () => {
    for (const host of [
      'evil.example',
      'evil.example:3000',
      'kumihan.evil.example:3000',
      'localhost.evil.example',
      'EVIL.EXAMPLE',
      'evil.example/assets/web.css?',
      'user@evil.example',
      '999.999.999.999',
      `${"a".repeat(256)}.example`,
    ]) {
      assert.equal(isAllowedHost(host, LOOPBACK_HOST_POLICY), false, host)
    }
  })

  it('Host の無い HTTP/1.0 は通す（ブラウザは必ず送る）', () => {
    assert.equal(isAllowedHost(undefined, LOOPBACK_HOST_POLICY), true)
    assert.equal(isAllowedHost('', LOOPBACK_HOST_POLICY), true)
  })

  it('待ち受けに指定した名前は通す', () => {
    const policy = createHostPolicy({ host: 'kumihan.example' })
    assert.equal(isAllowedHost('kumihan.example:3000', policy), true)
    assert.equal(isAllowedHost('evil.example:3000', policy), false)
  })

  it('全アドレス待ち受けは名前として扱わない', () => {
    for (const host of ['0.0.0.0', '::', '[::]', '*', '']) {
      const policy = createHostPolicy({ host })
      assert.equal(isAllowedHost('evil.example', policy), false, host)
      // LAN から IP で開くのは名前を経由しないので、そのまま通る。
      assert.equal(isAllowedHost('192.168.1.5:3000', policy), true, host)
    }
  })

  it('KUMIHAN_ALLOWED_HOSTS で名前と接尾辞を足せる', () => {
    const policy = createHostPolicy({ allowed: 'lab.example:3000, .trusted.example ,' })
    assert.equal(isAllowedHost('lab.example:3000', policy), true)
    assert.equal(isAllowedHost('lab.example', policy), true)
    assert.equal(isAllowedHost('a.trusted.example', policy), true)
    assert.equal(isAllowedHost('trusted.example', policy), false)
    assert.equal(isAllowedHost('nottrusted.example', policy), false)
    assert.equal(isAllowedHost('evil.example', policy), false)
  })

  it('Codespaces の転送ドメインは自動で通す', () => {
    const policy = createHostPolicy({ portForwardingDomain: 'app.github.dev' })
    assert.equal(isAllowedHost('kumihan-3000.app.github.dev', policy), true)
    assert.equal(isAllowedHost('app.github.dev', policy), false)
    assert.equal(isAllowedHost('evil.example', policy), false)
    const dotted = createHostPolicy({ portForwardingDomain: '.app.github.dev' })
    assert.equal(isAllowedHost('kumihan-3000.app.github.dev', dotted), true)
  })
})

class RecordingResponse {
  headersSent = false
  statusCode = 0
  status = 0
  headers: Record<string, unknown> = {}
  body = ''

  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.status = status
    this.headersSent = true
    if (headers) this.headers = headers
    return this
  }

  setHeader(name: string, value: string): this {
    this.headers[name] = value
    return this
  }

  end(chunk?: Buffer | string): this {
    if (chunk !== undefined) this.body = chunk.toString()
    return this
  }
}

describe('preview server rejects a rebound host', () => {
  async function get(host: string | undefined): Promise<RecordingResponse> {
    const res = new RecordingResponse()
    await dispatchNodeRequest(
      { headers: host === undefined ? {} : { host }, method: 'GET', url: '/' },
      res,
      () => Promise.resolve(new Response('原稿の中身', { status: 200 })),
    )
    return res
  }

  it('他人のドメインを名乗ると 403 で、原稿は返さない', async () => {
    const res = await get('evil.example:3000')
    assert.equal(res.status, 403)
    assert.equal(res.body.includes('原稿の中身'), false)
    assert.match(res.body, /KUMIHAN_ALLOWED_HOSTS/)
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  })

  it('ループバックからは今までどおり返す', async () => {
    for (const host of ['127.0.0.1:3000', 'localhost:3000', '[::1]:3000', undefined]) {
      const res = await get(host)
      assert.equal(res.status, 200, String(host))
      assert.equal(res.body, '原稿の中身')
    }
  })
})

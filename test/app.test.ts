import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { createPreviewApp } from '../src/app.js'
import { typesetCss } from '../src/typesetting/typeset.css.js'
import { webCss } from '../src/typesetting/web.css.js'

describe('preview app', () => {
  it('returns ok from /health', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const res = await app.request('/health')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Content-Type'), 'application/json')
    assert.deepEqual(await res.json(), { ok: true })
  })

  it('serves typeset css', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const res = await app.request('/assets/typeset.css')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Content-Type'), 'text/css; charset=utf-8')
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    const css = await res.text()
    assert.equal(css, typesetCss)
    assert.match(css, /column-count:\s*2/)
    assert.match(css, /height:\s*calc\(40 \* 1\.75em\)/)
    assert.match(css, /break-after:\s*page/)
  })

  it('serves web article css', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const res = await app.request('/assets/web.css')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Content-Type'), 'text/css; charset=utf-8')
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    assert.equal(await res.text(), webCss)
  })

  it('renders markdown from disk', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const res = await app.request('/')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    const html = await res.text()
    assert.match(html, /^<!DOCTYPE html>/)
    assert.match(html, /<article class="typeset">/)
    assert.match(html, /aria-label="表示モード"/)
    assert.match(html, /href="magazine.html"/)
    assert.match(html, /href="web.html"/)
  })

  it('renders the two-column view', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const magazineHtml = await app.request('/magazine.html')
    const magazineAlias = await app.request('/magazine')
    assert.equal(magazineHtml.status, 200)
    assert.equal(magazineAlias.status, 200)
    const html = await magazineHtml.text()
    const alias = await magazineAlias.text()
    assert.equal(html, alias)
    assert.match(html, /<article class="typeset cols-2">/)
    assert.match(html, /href="assets\/typeset.css"/)
    assert.match(html, /aria-current="page">2段</)
  })

  it('renders the web article view', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const webHtml = await app.request('/web.html')
    const webAlias = await app.request('/web')
    assert.equal(webHtml.status, 200)
    assert.equal(webAlias.status, 200)
    assert.equal(webHtml.headers.get('Content-Type'), 'text/html; charset=utf-8')
    const html = await webHtml.text()
    const alias = await webAlias.text()
    assert.equal(html, alias)
    assert.match(html, /<body class="web">/)
    assert.match(html, /<article class="article">/)
    assert.match(html, /href="assets\/web.css"/)
    assert.match(html, /aria-current="page">Web</)
  })

  it('returns 404 when the manuscript is missing', async () => {
    const app = createPreviewApp({ source: './content/does-not-exist.md' })
    const res = await app.request('/')
    assert.equal(res.status, 404)
    const html = await res.text()
    assert.match(html, /原稿が見つかりません/)
    assert.equal(html.toLowerCase().includes('enoent'), false)
  })

  it('reloads html so a saved manuscript shows up, without scripts', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    for (const path of ['/', '/magazine.html', '/magazine', '/web.html', '/web']) {
      const res = await app.request(path)
      assert.equal(res.status, 200, path)
      assert.equal(res.headers.get('Refresh'), '2', path)
      assert.equal(res.headers.get('Cache-Control'), 'no-store', path)
      assert.match(res.headers.get('Content-Security-Policy') ?? '', /script-src 'none'/)
      assert.equal((await res.text()).includes('http-equiv="refresh"'), false, path)
    }

    const missing = await createPreviewApp({ source: './content/does-not-exist.md' }).request('/')
    assert.equal(missing.status, 404)
    assert.equal(missing.headers.get('Refresh'), '2')

    const failed = await createPreviewApp({ source: './src' }).request('/')
    assert.equal(failed.status, 500)
    assert.equal(failed.headers.get('Refresh'), '2')

    for (const path of ['/health', '/assets/typeset.css', '/assets/web.css']) {
      const res = await app.request(path)
      assert.equal(res.headers.get('Refresh'), null, path)
    }
  })
})

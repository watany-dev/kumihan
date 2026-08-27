import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { createPreviewApp } from '../src/app.js'
import { magazineCss } from '../src/typesetting/magazine.css.js'
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
    assert.equal(await res.text(), typesetCss)
  })

  it('serves magazine css', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const res = await app.request('/assets/magazine.css')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Content-Type'), 'text/css; charset=utf-8')
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    assert.equal(await res.text(), magazineCss)
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
    assert.match(html, /href="feature.html"/)
    assert.match(html, /href="web.html"/)
  })

  it('renders the two-column magazine view', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const magazineHtml = await app.request('/magazine.html')
    const magazineAlias = await app.request('/magazine')
    assert.equal(magazineHtml.status, 200)
    assert.equal(magazineAlias.status, 200)
    const html = await magazineHtml.text()
    const alias = await magazineAlias.text()
    assert.equal(html, alias)
    assert.match(html, /<body class="magazine">/)
    assert.match(html, /<article class="typeset magazine-typeset">/)
    assert.match(html, /href="assets\/magazine.css"/)
    assert.match(html, /aria-current="page">2段</)
  })

  it('renders the magazine feature view', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const featureHtml = await app.request('/feature.html')
    const featureAlias = await app.request('/feature')
    assert.equal(featureHtml.status, 200)
    assert.equal(featureAlias.status, 200)
    const html = await featureHtml.text()
    const alias = await featureAlias.text()
    assert.equal(html, alias)
    assert.match(html, /<body class="feature">/)
    assert.match(html, /<article class="typeset feature-typeset">/)
    assert.match(html, /href="assets\/magazine.css"/)
    assert.match(html, /aria-current="page">特集</)
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
})

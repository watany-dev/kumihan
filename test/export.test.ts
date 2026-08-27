import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { exportSite } from '../src/export/export-site.js'
import { renderMarkdown } from '../src/markdown/render.js'
import { magazineCss } from '../src/typesetting/magazine.css.js'
import { renderDocument } from '../src/typesetting/render-page.js'
import { typesetCss } from '../src/typesetting/typeset.css.js'
import { webCss } from '../src/typesetting/web.css.js'

const sample = `# 見出し

これは日本語
の文章です。

[ok](https://example.com)
[bad](javascript:alert(1))
`

describe('exportSite', () => {
  it('emits print, magazine, feature, and web html with matching stylesheets', async () => {
    const assets = exportSite(sample)
    const paths = assets.map((asset) => asset.pathname)
    assert.deepEqual(paths, [
      '/index.html',
      '/magazine.html',
      '/feature.html',
      '/web.html',
      '/assets/typeset.css',
      '/assets/magazine.css',
      '/assets/web.css',
    ])

    const byPath = new Map(assets.map((asset) => [asset.pathname, asset]))
    const index = byPath.get('/index.html')
    const magazine = byPath.get('/magazine.html')
    const feature = byPath.get('/feature.html')
    const web = byPath.get('/web.html')
    const css = byPath.get('/assets/typeset.css')
    const magazineStyles = byPath.get('/assets/magazine.css')
    const webStyles = byPath.get('/assets/web.css')
    assert.ok(index)
    assert.ok(magazine)
    assert.ok(feature)
    assert.ok(web)
    assert.ok(css)
    assert.ok(magazineStyles)
    assert.ok(webStyles)

    assert.equal(index.response.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(magazine.response.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(feature.response.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(web.response.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(css.response.headers.get('Content-Type'), 'text/css; charset=utf-8')
    assert.equal(magazineStyles.response.headers.get('Content-Type'), 'text/css; charset=utf-8')
    assert.equal(webStyles.response.headers.get('Content-Type'), 'text/css; charset=utf-8')
    assert.equal(await css.response.text(), typesetCss)
    assert.equal(await magazineStyles.response.text(), magazineCss)
    assert.equal(await webStyles.response.text(), webCss)
  })

  it('uses the same renderer as preview', async () => {
    const fragment = renderMarkdown(sample)
    const assets = exportSite(sample)
    const expected = {
      '/index.html': renderDocument(fragment),
      '/magazine.html': renderDocument(fragment, { mode: 'magazine' }),
      '/feature.html': renderDocument(fragment, { mode: 'feature' }),
      '/web.html': renderDocument(fragment, { mode: 'web' }),
    } as const

    for (const [pathname, preview] of Object.entries(expected)) {
      const asset = assets.find((item) => item.pathname === pathname)
      assert.ok(asset)
      assert.equal(await asset.response.text(), preview)
    }
  })

  it('forwards document options into the exported HTML', async () => {
    const assets = exportSite('# Title', { title: 'Exported', language: 'en' })
    const index = assets.find((asset) => asset.pathname === '/index.html')
    assert.ok(index)
    const html = await index.response.text()
    assert.match(html, /<html lang="en">/)
    assert.match(html, /<title>Exported<\/title>/)
    const magazine = assets.find((asset) => asset.pathname === '/magazine.html')
    assert.ok(magazine)
    const magazineHtml = await magazine.response.text()
    assert.match(magazineHtml, /<html lang="en">/)
    assert.match(magazineHtml, /<title>Exported<\/title>/)
    assert.match(magazineHtml, /<body class="magazine">/)
    const web = assets.find((asset) => asset.pathname === '/web.html')
    assert.ok(web)
    const webHtml = await web.response.text()
    assert.match(webHtml, /<html lang="en">/)
    assert.match(webHtml, /<title>Exported<\/title>/)
    assert.match(webHtml, /<body class="web">/)
  })

  it('always emits every mode even if a mode option is passed', async () => {
    const assets = exportSite('# Title', { mode: 'web' })
    const index = assets.find((asset) => asset.pathname === '/index.html')
    const magazine = assets.find((asset) => asset.pathname === '/magazine.html')
    const feature = assets.find((asset) => asset.pathname === '/feature.html')
    const web = assets.find((asset) => asset.pathname === '/web.html')
    assert.ok(index)
    assert.ok(magazine)
    assert.ok(feature)
    assert.ok(web)
    assert.match(await index.response.text(), /<div class="paper">/)
    assert.match(await magazine.response.text(), /<body class="magazine">/)
    assert.match(await feature.response.text(), /<body class="feature">/)
    assert.match(await web.response.text(), /<body class="web">/)
  })
})

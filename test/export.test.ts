import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { exportSite } from '../src/export/export-site.js'
import { renderMarkdown } from '../src/markdown/render.js'
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
  it('emits print and web html with matching stylesheets', async () => {
    const assets = exportSite(sample)
    const paths = assets.map((asset) => asset.pathname)
    assert.deepEqual(paths, ['/index.html', '/web.html', '/assets/typeset.css', '/assets/web.css'])

    const index = assets[0]
    const web = assets[1]
    const css = assets[2]
    const webStyles = assets[3]
    assert.ok(index)
    assert.ok(web)
    assert.ok(css)
    assert.ok(webStyles)

    assert.equal(index.response.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(web.response.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(css.response.headers.get('Content-Type'), 'text/css; charset=utf-8')
    assert.equal(webStyles.response.headers.get('Content-Type'), 'text/css; charset=utf-8')
    assert.equal(await css.response.text(), typesetCss)
    assert.equal(await webStyles.response.text(), webCss)
  })

  it('uses the same renderer as preview', async () => {
    const preview = renderDocument(renderMarkdown(sample))
    const webPreview = renderDocument(renderMarkdown(sample), { mode: 'web' })
    const assets = exportSite(sample)
    const index = assets.find((asset) => asset.pathname === '/index.html')
    const web = assets.find((asset) => asset.pathname === '/web.html')
    assert.ok(index)
    assert.ok(web)
    assert.equal(await index.response.text(), preview)
    assert.equal(await web.response.text(), webPreview)
  })

  it('forwards document options into the exported HTML', async () => {
    const assets = exportSite('# Title', { title: 'Exported', language: 'en' })
    const index = assets.find((asset) => asset.pathname === '/index.html')
    assert.ok(index)
    const html = await index.response.text()
    assert.match(html, /<html lang="en">/)
    assert.match(html, /<title>Exported<\/title>/)
    const web = assets.find((asset) => asset.pathname === '/web.html')
    assert.ok(web)
    const webHtml = await web.response.text()
    assert.match(webHtml, /<html lang="en">/)
    assert.match(webHtml, /<title>Exported<\/title>/)
    assert.match(webHtml, /<body class="web">/)
  })

  it('always emits both modes even if a mode option is passed', async () => {
    const assets = exportSite('# Title', { mode: 'web' })
    const index = assets.find((asset) => asset.pathname === '/index.html')
    const web = assets.find((asset) => asset.pathname === '/web.html')
    assert.ok(index)
    assert.ok(web)
    assert.match(await index.response.text(), /<div class="paper">/)
    assert.match(await web.response.text(), /<body class="web">/)
  })
})

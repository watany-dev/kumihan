import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { exportSite } from '../src/export/export-site.js'
import { renderMarkdown } from '../src/markdown/render.js'
import { renderDocument } from '../src/typesetting/render-page.js'
import { typesetCss } from '../src/typesetting/typeset.css.js'

const sample = `# 見出し

これは日本語
の文章です。

[ok](https://example.com)
[bad](javascript:alert(1))
`

describe('exportSite', () => {
  it('emits index.html and typeset.css', async () => {
    const assets = exportSite(sample)
    const paths = assets.map((asset) => asset.pathname)
    assert.deepEqual(paths, ['/index.html', '/assets/typeset.css'])

    const index = assets[0]
    const css = assets[1]
    assert.ok(index)
    assert.ok(css)

    assert.equal(
      index.response.headers.get('Content-Type'),
      'text/html; charset=utf-8',
    )
    assert.equal(
      css.response.headers.get('Content-Type'),
      'text/css; charset=utf-8',
    )
    assert.equal(await css.response.text(), typesetCss)
  })

  it('uses the same renderer as preview', async () => {
    const preview = renderDocument(renderMarkdown(sample))
    const assets = exportSite(sample)
    const index = assets.find((asset) => asset.pathname === '/index.html')
    assert.ok(index)
    const exported = await index.response.text()
    assert.equal(exported, preview)
  })
})

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vite-plus/test'

import { exportSite } from '../src/export/export-site.js'
import { writeExport } from '../src/export/write-files.js'
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
  it('emits print, magazine, and web html with matching stylesheets', async () => {
    const assets = exportSite(sample)
    const paths = assets.map((asset) => asset.pathname)
    assert.deepEqual(paths, [
      '/index.html',
      '/magazine.html',
      '/web.html',
      '/assets/typeset.css',
      '/assets/web.css',
    ])

    const index = assets[0]
    const magazine = assets[1]
    const web = assets[2]
    const css = assets[3]
    const webStyles = assets[4]
    assert.ok(index)
    assert.ok(magazine)
    assert.ok(web)
    assert.ok(css)
    assert.ok(webStyles)

    assert.equal(index.response.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(magazine.response.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(web.response.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(index.response.headers.get('Refresh'), null)
    assert.equal(magazine.response.headers.get('Refresh'), null)
    assert.equal(web.response.headers.get('Refresh'), null)
    assert.equal((await index.response.clone().text()).includes('http-equiv="refresh"'), false)
    assert.equal(css.response.headers.get('Content-Type'), 'text/css; charset=utf-8')
    assert.equal(webStyles.response.headers.get('Content-Type'), 'text/css; charset=utf-8')
    assert.equal(await css.response.text(), typesetCss)
    assert.equal(await webStyles.response.text(), webCss)
  })

  it('uses the same renderer as preview', async () => {
    const fragment = renderMarkdown(sample)
    const assets = exportSite(sample)
    const expected = {
      '/index.html': renderDocument(fragment),
      '/magazine.html': renderDocument(fragment, { mode: 'magazine' }),
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
    assert.match(magazineHtml, /<article class="typeset cols-2">/)
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
    const web = assets.find((asset) => asset.pathname === '/web.html')
    assert.ok(index)
    assert.ok(magazine)
    assert.ok(web)
    assert.match(await index.response.text(), /<article class="typeset">/)
    assert.match(await magazine.response.text(), /<article class="typeset cols-2">/)
    assert.match(await web.response.text(), /<body class="web">/)
  })
})

describe('writeExport', () => {
  it('writes html and css under the output directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-export-'))
    try {
      const source = join(dir, 'index.md')
      await writeFile(source, '# Hello\n')
      const written = await writeExport(source, join(dir, 'out'))
      assert.ok(written.some((path) => path.endsWith('index.html')))
      assert.match(await readFile(written[0] ?? '', 'utf8'), /Hello/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, it } from 'vite-plus/test'

import { exportSite } from '../src/export/export-site.js'
import { writeExport } from '../src/export/write-files.js'
import { contained } from '../src/manuscript-path.js'
import { memoryManuscript } from '../src/manuscript.js'
import { renderMarkdown } from '../src/markdown/render.js'
import { renderDocument } from '../src/typesetting/render-page.js'
import { typesetCss } from '../src/typesetting/typeset.css.js'
import { webCss } from '../src/typesetting/web.css.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

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

  it('copies local images and leaves http(s) src in place', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-export-img-'))
    const logged: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    }
    try {
      const source = join(dir, 'index.md')
      await writeFile(
        source,
        '![図](a.png)\n\n![dot](./a.png)\n\n![n](images/n.png)\n\n![x](https://example.com/b.png)\n\n![y](missing.png)\n',
      )
      await writeFile(join(dir, 'a.png'), PNG)
      await mkdir(join(dir, 'images'))
      await writeFile(join(dir, 'images', 'n.png'), PNG)
      const out = join(dir, 'out')
      const written = await writeExport(source, out)
      assert.ok(written.some((path) => path.endsWith('a.png')))
      assert.ok(written.some((path) => path.endsWith(join('images', 'n.png'))))
      assert.deepEqual(await readFile(join(out, 'a.png')), PNG)
      assert.deepEqual(await readFile(join(out, 'images', 'n.png')), PNG)
      const html = await readFile(join(out, 'index.html'), 'utf8')
      const magazine = await readFile(join(out, 'magazine.html'), 'utf8')
      const web = await readFile(join(out, 'web.html'), 'utf8')
      assert.match(html, /src="a.png"/)
      assert.match(html, /src="\.\/a.png"/)
      assert.match(html, /src="images\/n.png"/)
      assert.match(magazine, /src="a.png"/)
      assert.match(web, /src="a.png"/)
      assert.match(html, /src="https:\/\/example.com\/b.png"/)
      assert.equal(html.includes('src="missing.png"'), true)
      assert.equal(
        written.some((path) => path.endsWith('b.png')),
        false,
      )
      assert.ok(logged.some((line) => line.includes('missing.png')))
    } finally {
      console.error = original
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not copy an in-root image outside the output directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-export-escape-'))
    const logged: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    }
    try {
      const ms = join(dir, 'ms')
      await mkdir(ms)
      await writeFile(join(ms, 'a.png'), PNG)
      await writeFile(join(ms, 'index.md'), '![x](../ms/a.png)\n\n![y](%2e%2e/ms/a.png)\n')
      const out = join(dir, 'out')
      const written = await writeExport(join(ms, 'index.md'), out)
      const destRoot = resolve(out)
      for (const path of written) {
        assert.equal(contained(destRoot, resolve(path)), true, path)
      }
      assert.deepEqual(await readFile(join(ms, 'a.png')), PNG)
      assert.ok(logged.some((line) => line.includes('../ms/a.png')))
      assert.ok(logged.some((line) => line.includes('%2e%2e/ms/a.png')))
    } finally {
      console.error = original
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('skips an image whose reference is broken percent-encoding', async () => {
    // 名前に生の `%` を含む画像は、URL 符号化として壊れていることがあります
    // （`a%zz.png` など）。出力先のパスへ戻せないので、その画像だけ諦めて
    // 書き出し自体は続けます。
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-export-percent-'))
    const logged: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    }
    try {
      await writeFile(join(dir, 'a%zz.png'), PNG)
      const source = join(dir, 'index.md')
      await writeFile(source, '![x](a%zz.png)\n')
      const out = join(dir, 'out')
      const written = await writeExport(source, out)
      assert.ok(written.some((path) => path.endsWith('index.html')))
      assert.equal(
        written.some((path) => path.endsWith('.png')),
        false,
      )
      assert.ok(logged.some((line) => line.includes('画像の出力先が不正です')))
    } finally {
      console.error = original
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('exports markdown handed in directly, resolving images from the given root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-export-stdin-'))
    try {
      await writeFile(join(dir, 'a.png'), PNG)
      const out = join(dir, 'out')
      // パイプで渡した本文には元ファイルが無いので、画像は root から探す。
      await writeExport(memoryManuscript('# パイプ\n\n![図](a.png)\n', dir), out)
      assert.deepEqual(await readFile(join(out, 'a.png')), PNG)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

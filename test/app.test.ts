import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vite-plus/test'

import { createPreviewApp } from '../src/app.js'
import { memoryManuscript } from '../src/manuscript.js'
import { typesetCss } from '../src/typesetting/typeset.css.js'
import { webCss } from '../src/typesetting/web.css.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('preview app', () => {
  it('returns ok from /health', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const res = await app.request('/health')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Content-Type'), 'application/json')
    assert.equal(res.headers.get('Refresh'), null)
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
    // 画面外の頁を組まない指定と、紙に出すときの打ち消し。
    assert.match(css, /content-visibility:\s*auto/)
    assert.match(css, /contain-intrinsic-size:\s*auto 210mm auto 297mm/)
    assert.match(css, /content-visibility:\s*visible/)
    assert.match(css, /max-width:\s*100%/)
    assert.match(css, /p:has\(> img:only-child\)/)
  })

  it('serves web article css', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const res = await app.request('/assets/web.css')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Content-Type'), 'text/css; charset=utf-8')
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    assert.equal(await res.text(), webCss)
    assert.match(webCss, /\.article img/)
    assert.match(webCss, /max-width:\s*100%/)
    // 画面外のブロックを組まない指定。
    assert.match(webCss, /content-visibility:\s*auto/)
    assert.match(webCss, /contain-intrinsic-size:\s*auto 3rem/)
  })

  it('renders markdown from disk', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const res = await app.request('/')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    assert.equal(res.headers.get('Refresh'), '2')
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
    assert.equal(res.headers.get('Refresh'), '2')
    const html = await res.text()
    assert.match(html, /原稿が見つかりません/)
    assert.equal(html.toLowerCase().includes('enoent'), false)
  })
})

describe('preview images', () => {
  it('serves an image next to the manuscript and rejects paths outside the root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-preview-img-'))
    const root = join(dir, 'ms')
    try {
      await writeFile(join(dir, 'secret.png'), PNG)
      await mkdir(root)
      await writeFile(join(root, 'index.md'), '![図](a.png)\n')
      await writeFile(join(root, 'a.png'), PNG)
      const app = createPreviewApp({ source: join(root, 'index.md') })
      const ok = await app.request('/a.png')
      assert.equal(ok.status, 200)
      assert.equal(ok.headers.get('Content-Type'), 'image/png')
      assert.equal(ok.headers.get('Cache-Control'), 'no-store')
      assert.equal(ok.headers.get('Refresh'), null)
      assert.equal(ok.headers.get('X-Content-Type-Options'), 'nosniff')
      assert.match(ok.headers.get('Content-Security-Policy') ?? '', /img-src 'self' https: http:/)
      assert.deepEqual(Buffer.from(await ok.arrayBuffer()), PNG)

      const html = await app.request('/')
      assert.match(await html.text(), /<img src="a.png" alt="図">/)

      const outside = await app.request('/%2e%2e/secret.png')
      assert.equal(outside.status, 404)
      assert.equal(outside.headers.get('Refresh'), null)

      const missing = await app.request('/missing.png')
      assert.equal(missing.status, 404)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns 404 when the image path is a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-preview-dir-'))
    try {
      await mkdir(join(dir, 'a.png'))
      await writeFile(join(dir, 'index.md'), '![x](a.png)\n')
      const app = createPreviewApp({ source: join(dir, 'index.md') })
      assert.equal((await app.request('/a.png')).status, 404)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serves markdown handed in directly, in every mode', async () => {
    const app = createPreviewApp({ source: memoryManuscript('# パイプ原稿\n') })
    for (const path of ['/', '/magazine.html', '/web.html']) {
      const res = await app.request(path)
      assert.equal(res.status, 200)
      assert.match(await res.text(), /パイプ原稿/)
    }
  })

  it('serves images next to the given root for a directly handed manuscript', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-app-stdin-'))
    try {
      await writeFile(join(dir, 'a.png'), PNG)
      const app = createPreviewApp({ source: memoryManuscript('![図](a.png)\n', dir) })
      const res = await app.request('/a.png')
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('Content-Type'), 'image/png')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('preview reuse', () => {
  it('repeats the same document for an unchanged manuscript', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const first = await (await app.request('/')).text()
    const second = await (await app.request('/')).text()
    assert.equal(second, first)
  })

  it('picks up an edited manuscript in every mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-app-edit-'))
    const file = join(dir, 'index.md')
    try {
      await writeFile(file, '# 書きかけ\n')
      const app = createPreviewApp({ source: file })

      // 組み直しを飛ばす判断は原稿の中身だけで行うので、いったん全モードを
      // 読ませてから書き換え、どのモードにも新しい原稿が出ることを確かめます。
      for (const path of ['/', '/magazine.html', '/web.html']) {
        assert.match(await (await app.request(path)).text(), /書きかけ/)
      }

      await writeFile(file, '# 書き上げた\n')

      for (const path of ['/', '/magazine.html', '/web.html']) {
        const html = await (await app.request(path)).text()
        assert.match(html, /書き上げた/)
        assert.doesNotMatch(html, /書きかけ/)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('shows the manuscript again after it is restored to an earlier state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-app-undo-'))
    const file = join(dir, 'index.md')
    try {
      await writeFile(file, '# もとの原稿\n')
      const app = createPreviewApp({ source: file })
      const original = await (await app.request('/')).text()

      await writeFile(file, '# 直した原稿\n')
      assert.match(await (await app.request('/')).text(), /直した原稿/)

      // 取り消して元に戻したとき（mtime は進むが中身は前と同じ）。
      await writeFile(file, '# もとの原稿\n')
      assert.equal(await (await app.request('/')).text(), original)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

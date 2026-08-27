import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createPreviewApp } from '../src/app.js'

describe('createPreviewApp', () => {
  it('serves /health', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const response = await app.request('/health')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  })

  it('renders the markdown source on GET /', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-'))
    const source = join(dir, 'index.md')
    await writeFile(source, '# プレビュー\n\n本文です。\n')

    const app = createPreviewApp({
      source,
      title: 'Test Preview',
      language: 'ja',
    })
    const response = await app.request('/')
    assert.equal(response.status, 200)
    assert.equal(
      response.headers.get('Content-Type'),
      'text/html; charset=utf-8',
    )
    assert.equal(response.headers.get('Cache-Control'), 'no-store')

    const html = await response.text()
    assert.match(html, /<h1>プレビュー<\/h1>/)
    assert.match(html, /本文です。/)
    assert.match(html, /class="paper"/)
    assert.match(html, /class="typeset"/)
  })

  it('returns a 404 page when the source is missing', async () => {
    const app = createPreviewApp({ source: './missing-content.md' })
    const response = await app.request('/')
    assert.equal(response.status, 404)
    const html = await response.text()
    assert.match(html, /原稿が見つかりません/)
    assert.equal(html.includes('ENOENT'), false)
  })

  it('serves typesetting CSS', async () => {
    const app = createPreviewApp({ source: './content/index.md' })
    const response = await app.request('/assets/typeset.css')
    assert.equal(response.status, 200)
    assert.equal(
      response.headers.get('Content-Type'),
      'text/css; charset=utf-8',
    )
    const css = await response.text()
    assert.match(css, /\.paper \{/)
    assert.match(css, /@page \{/)
  })
})

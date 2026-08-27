import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { renderMarkdown } from '../src/markdown/render.js'
import { renderDocument } from '../src/typesetting/render-page.js'

describe('renderDocument', () => {
  it('generates a complete HTML document', () => {
    const html = renderDocument(renderMarkdown('# 見出し'), {
      title: '組版',
      language: 'ja',
    })

    assert.match(html, /^<!DOCTYPE html>/)
    assert.match(html, /<html lang="ja">/)
    assert.match(html, /<title>組版<\/title>/)
    assert.match(html, /http-equiv="Content-Security-Policy"/)
    assert.match(html, /content="default-src 'none'/)
    assert.equal(html.includes('frame-ancestors'), false)
    assert.match(html, /name="referrer" content="no-referrer"/)
    assert.match(html, /<div class="paper">/)
    assert.match(html, /<article class="typeset">/)
    assert.match(html, /<h1>見出し<\/h1>/)
    assert.match(html, /href="assets\/typeset.css"/)
    assert.match(html, /aria-label="表示モード"/)
    assert.match(html, /aria-current="page">組版</)
    assert.match(html, /href="web.html"/)
    assert.match(html, /<\/html>\s*$/)
  })

  it('generates a web article document', () => {
    const html = renderDocument(renderMarkdown('# 見出し\n\n導入です。'), {
      title: 'Web',
      language: 'ja',
      mode: 'web',
    })

    assert.match(html, /^<!DOCTYPE html>/)
    assert.match(html, /<html lang="ja">/)
    assert.match(html, /<title>Web<\/title>/)
    assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/)
    assert.match(html, /http-equiv="Content-Security-Policy"/)
    assert.equal(html.includes('frame-ancestors'), false)
    assert.equal(html.includes('class="paper"'), false)
    assert.match(html, /<body class="web">/)
    assert.match(html, /<article class="article">/)
    assert.match(html, /<h1>見出し<\/h1>/)
    assert.match(html, /href="assets\/web.css"/)
    assert.match(html, /aria-current="page">Web</)
    assert.match(html, /href="\.\/"/)
    assert.match(html, /<\/html>\s*$/)
  })

  it('uses default title, language, and print mode', () => {
    const html = renderDocument('<p>ok</p>')
    assert.match(html, /<html lang="ja">/)
    assert.match(html, /<title>Typeset Preview<\/title>/)
    assert.match(html, /<div class="paper">/)
    assert.equal(html.includes('name="viewport"'), false)
  })

  it('accepts an explicit print mode', () => {
    const html = renderDocument('<p>ok</p>', { mode: 'print' })
    assert.match(html, /<div class="paper">/)
    assert.match(html, /href="assets\/typeset.css"/)
  })

  it('escapes document title', () => {
    const html = renderDocument('<p>ok</p>', { title: '<script>x</script>' })
    assert.equal(html.includes('<title><script>'), false)
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/)
  })

  it('escapes the document language', () => {
    const html = renderDocument('<p>ok</p>', { language: 'ja"><script>' })
    assert.equal(html.includes('<script>'), false)
    assert.match(html, /lang="ja&quot;&gt;&lt;script&gt;"/)
  })
})

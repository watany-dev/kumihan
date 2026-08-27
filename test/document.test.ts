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
    assert.match(html, /<\/html>\s*$/)
  })

  it('uses default title and language', () => {
    const html = renderDocument('<p>ok</p>')
    assert.match(html, /<html lang="ja">/)
    assert.match(html, /<title>Typeset Preview<\/title>/)
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

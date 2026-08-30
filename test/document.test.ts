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
    assert.match(html, /img-src 'self' https: http:/)
    assert.equal(html.includes('frame-ancestors'), false)
    assert.match(html, /name="referrer" content="no-referrer"/)
    assert.match(html, /<div class="paper" data-page="1">/)
    assert.match(html, /<article class="typeset">/)
    assert.match(html, /<h1>見出し<\/h1>/)
    assert.match(html, /href="assets\/typeset.css"/)
    assert.match(html, /aria-label="表示モード"/)
    assert.match(html, /aria-current="page">組版</)
    assert.match(html, /href="magazine.html"/)
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
    assert.match(html, /href="magazine.html"/)
    assert.match(html, /<\/html>\s*$/)
  })

  it('generates a two-column print document', () => {
    const html = renderDocument(renderMarkdown('# 見出し\n\n導入です。'), {
      title: '2段',
      mode: 'magazine',
    })

    assert.match(html, /<article class="typeset cols-2">/)
    assert.match(html, /href="assets\/typeset.css"/)
    assert.match(html, /aria-current="page">2段</)
    assert.equal(html.includes('name="viewport"'), false)
  })

  it('uses default title, language, and print mode', () => {
    const html = renderDocument('<p>ok</p>')
    assert.match(html, /<html lang="ja">/)
    assert.match(html, /<title>Typeset Preview<\/title>/)
    assert.match(html, /<div class="paper" data-page="1">/)
    assert.equal(html.includes('name="viewport"'), false)
  })

  it('accepts an explicit print mode', () => {
    const html = renderDocument('<p>ok</p>', { mode: 'print' })
    assert.match(html, /<div class="paper" data-page="1">/)
    assert.match(html, /href="assets\/typeset.css"/)
    assert.equal(html.includes('cols-2'), false)
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

describe('ノンブルと柱', () => {
  const long = Array.from({ length: 90 }, () => '短い段落です。').join('\n\n')

  it('組版ビューの各紙に通し番号を振る', () => {
    const html = renderDocument(renderMarkdown(long))
    assert.deepEqual(
      [...html.matchAll(/data-page="(\d+)"/g)].map((match) => match[1]),
      ['1', '2', '3', '4'],
    )
  })

  it('2段ビューの各紙にも通し番号を振る', () => {
    const html = renderDocument(renderMarkdown(long), { mode: 'magazine' })
    const pages = [...html.matchAll(/data-page="(\d+)"/g)].map((match) => match[1])
    assert.ok(pages.length >= 2)
    assert.deepEqual(
      pages,
      pages.map((_, index) => String(index + 1)),
    )
  })

  it('1 枚だけの原稿にも 1 を出す', () => {
    const html = renderDocument(renderMarkdown('# 見出し\n\n短い原稿です。'))
    assert.equal((html.match(/data-page="/g) ?? []).length, 1)
    assert.match(html, /data-page="1"/)
  })

  it('柱は h1 の文字を 2 枚目から出す', () => {
    const html = renderDocument(renderMarkdown(`# 見出し\n\n${long}`))
    const papers = html.split('<div class="paper"').slice(1)
    assert.ok(papers.length >= 2)
    assert.equal(papers[0]?.includes('data-head'), false)
    for (const paper of papers.slice(1)) {
      assert.match(paper, /data-head="見出し"/)
    }
  })

  it('h1 の無い原稿には柱を出さない', () => {
    const html = renderDocument(renderMarkdown(long))
    assert.equal(html.includes('data-head'), false)
  })

  it('柱から見出しの中のタグを外す', () => {
    const html = renderDocument(renderMarkdown(`# **強調**の見出し\n\n${long}`))
    assert.match(html, /data-head="強調の見出し"/)
  })

  it('Web 記事ビューには出さない', () => {
    const html = renderDocument(renderMarkdown(`# 見出し\n\n${long}`), { mode: 'web' })
    assert.equal(html.includes('data-page'), false)
    assert.equal(html.includes('data-head'), false)
  })
})

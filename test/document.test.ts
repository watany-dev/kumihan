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

  it('embeds the live-reload script only when a version is handed in', () => {
    const preview = renderDocument('<p>ok</p>', { liveReload: 'abcdef0123456789' })
    assert.match(
      preview,
      /<script src="assets\/reload.js" data-kumihan-version="abcdef0123456789" defer><\/script>/,
    )
    // スクリプトが動かないブラウザは、以前と同じ 2 秒間隔の再読み込み。
    assert.match(preview, /<noscript><meta http-equiv="refresh" content="2"><\/noscript>/)
    // プレビューの CSP は自分のスクリプトと EventSource だけ通す。
    assert.match(preview, /script-src 'self'/)
    assert.match(preview, /connect-src 'self'/)
    assert.match(preview, /script-src-attr 'none'/)

    // export した静的 HTML にはスクリプトを入れず、CSP も締めたまま。
    const exported = renderDocument('<p>ok</p>')
    assert.equal(/<script\b/i.test(exported), false)
    assert.equal(exported.includes('noscript'), false)
    assert.match(exported, /script-src 'none'/)
    assert.match(exported, /connect-src 'none'/)
  })

  it('escapes the live-reload version', () => {
    const html = renderDocument('<p>ok</p>', { liveReload: '"><script>x</script>' })
    assert.equal(html.includes('<script>x'), false)
    assert.match(html, /data-kumihan-version="&quot;&gt;&lt;script&gt;x&lt;\/script&gt;"/)
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

  it('adds a diff switcher link only when asked', () => {
    const off = renderDocument('<p>ok</p>', { mode: 'web' })
    assert.equal(off.includes('diff.html'), false)
    assert.equal((off.match(/class="mode-switch-link/g) ?? []).length, 3)

    const on = renderDocument('<p>ok</p>', { mode: 'web', diffLink: true })
    assert.match(on, /href="web-diff.html"[^>]*>差分</)
    assert.match(on, /aria-pressed="false">差分</)
    assert.match(on, /aria-current="page">Web</)
    assert.doesNotMatch(on, /aria-current="page">差分</)
    assert.match(on, /href="web.html"/)

    const active = renderDocument('<p>ok</p>', { mode: 'web', diffLink: true, diffActive: true })
    assert.match(active, /aria-pressed="true">差分</)
    assert.match(active, /href="web.html"[^>]*>差分</)
    assert.match(active, /aria-current="page">Web</)
    assert.match(active, /href="web-diff.html"/)
    assert.match(active, /href="diff.html">組版</)
    assert.match(active, /href="magazine-diff.html">2段</)
    assert.doesNotMatch(active, /aria-current="page">差分</)
    assert.doesNotMatch(active, /is-active"[^>]*>差分</)

    const print = renderDocument('<p>ok</p>', { diffLink: true })
    assert.match(print, /href="diff.html"[^>]*>差分</)
    assert.match(print, /aria-current="page">組版</)
    assert.match(print, /aria-pressed="false">差分</)

    const printDiff = renderDocument('<p>ok</p>', { diffLink: true, diffActive: true })
    assert.match(printDiff, /href="\.\/"[^>]*>差分</)
    assert.match(printDiff, /href="diff.html"/)
    assert.match(printDiff, /aria-current="page">組版</)
    assert.match(printDiff, /aria-pressed="true">差分</)
  })
})

describe('図版', () => {
  const source = ['![一枚目](a.png)', '本文 ![文中](b.png) です。', '![](c.png)'].join('\n\n')

  it('numbers the figures in manuscript order', () => {
    const html = renderDocument(renderMarkdown(source))
    const captions = [...html.matchAll(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/g)].map(
      (found) => found[1],
    )

    assert.deepEqual(captions, [
      '<span class="figure-number">図 1　</span>一枚目',
      // alt が空でも番号は付きます。
      '<span class="figure-number">図 2</span>',
    ])
    // 文中に混ざった画像は段落のままで、番号も取りません。
    assert.match(html, /<p>本文 <img src="b.png" alt="文中"> です。<\/p>/)
  })

  it('numbers the figures the same way in every mode', () => {
    for (const mode of ['print', 'magazine', 'web'] as const) {
      const html = renderDocument(renderMarkdown(source), { mode })
      assert.match(html, /<span class="figure-number">図 1　<\/span>一枚目/)
      assert.match(
        html,
        /<figcaption class="number-only"><span class="figure-number">図 2<\/span><\/figcaption>/,
      )
    }
  })

  it('keeps the numbering across papers', () => {
    const filler = Array.from({ length: 40 }, () => '長い段落です。'.repeat(20)).join('\n\n')
    const html = renderDocument(renderMarkdown(`![前](a.png)\n\n${filler}\n\n![後](b.png)`))
    const papers = html.split('<div class="paper"').length - 1

    assert.ok(papers > 1)
    assert.match(html, /<span class="figure-number">図 1　<\/span>前/)
    assert.match(html, /<span class="figure-number">図 2　<\/span>後/)
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

  it('柱は削除された旧題を飛ばす', () => {
    const html = renderDocument(
      `<h1 class="diff-removed">旧題</h1>\n<h1 class="diff-added">新題</h1>\n${renderMarkdown(long)}`,
    )
    const papers = html.split('<div class="paper"').slice(1)
    assert.ok(papers.length >= 2)
    assert.doesNotMatch(html, /data-head="旧題"/)
    for (const paper of papers.slice(1)) {
      assert.match(paper, /data-head="新題"/)
    }
  })

  it('Web 記事ビューには出さない', () => {
    const html = renderDocument(renderMarkdown(`# 見出し\n\n${long}`), { mode: 'web' })
    assert.equal(html.includes('data-page'), false)
    assert.equal(html.includes('data-head'), false)
  })
})

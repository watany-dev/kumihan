import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { renderMarkdown } from '../src/markdown/render.js'
import { MAGAZINE_LINES_PER_PAGE, paginateMagazine } from '../src/typesetting/paginate.js'
import { renderDocument } from '../src/typesetting/render-page.js'

function papers(html: string): string[] {
  return [...html.matchAll(/<article class="typeset cols-2">([\s\S]*?)<\/article>/g)].map(
    (match) => match[1] ?? '',
  )
}

function paragraphs(count: number, text = '短い段落です。'): string {
  return Array.from({ length: count }, () => text).join('\n\n')
}

describe('paginateMagazine', () => {
  it('keeps short copy on a single page', () => {
    const pages = paginateMagazine(renderMarkdown('# 見出し\n\n導入です。'))
    assert.equal(pages.length, 1)
    assert.match(pages[0] ?? '', /<h1>見出し<\/h1>/)
    assert.match(pages[0] ?? '', /<p>導入です。<\/p>/)
  })

  it('returns one empty page for blank input', () => {
    assert.deepEqual(paginateMagazine(''), [''])
    assert.deepEqual(paginateMagazine(' \n\t'), [''])
  })

  it('splits long copy into pages of about 40 lines', () => {
    const pages = paginateMagazine(renderMarkdown(paragraphs(80)))
    assert.ok(pages.length >= 2)
    const joined = pages.join('\n')
    assert.equal((joined.match(/<p>/g) ?? []).length, 80)
    for (const page of pages) {
      assert.match(page, /<p>/)
    }
  })

  it('keeps the title and lead on the same page', () => {
    const source = `# 見出し

リード文です。

${paragraphs(60)}`
    const pages = paginateMagazine(renderMarkdown(source))
    assert.ok(pages.length >= 2)
    assert.match(pages[0] ?? '', /<h1>見出し<\/h1>\n<p>リード文です。<\/p>/)
  })

  it('moves the title and lead together when the current page is full', () => {
    const source = `${paragraphs(50)}

# 後半

リード文です。`
    const pages = paginateMagazine(renderMarkdown(source))
    assert.ok(pages.length >= 2)
    const later = pages.filter((page) => page.includes('<h1>後半</h1>'))
    assert.equal(later.length, 1)
    assert.match(later[0] ?? '', /<h1>後半<\/h1>\n<p>リード文です。<\/p>/)
  })

  it('keeps a heading without a lead together', () => {
    const pages = paginateMagazine(renderMarkdown('# 見出し\n\n## 節'))
    assert.equal(pages.length, 1)
    assert.match(pages[0] ?? '', /<h1>見出し<\/h1>\n<h2>節<\/h2>/)
  })

  it('does not let a heading swallow the blocks after it', () => {
    const pages = paginateMagazine(renderMarkdown(`# 見出し\n\n## 節\n\n${paragraphs(80)}`))
    assert.ok(pages.length >= 2)
    assert.match(pages[0] ?? '', /<h1>見出し<\/h1>/)
    assert.match(pages[0] ?? '', /<h2>節<\/h2>/)
    assert.ok((pages[0] ?? '').split('<p>').length - 1 < 80)
  })

  it('puts an oversized block on its own page', () => {
    const code = ['```', ...Array.from({ length: 80 }, (_, i) => `line-${i}`), '```'].join('\n')
    const source = `${paragraphs(8)}\n\n${code}\n\n後続の段落。`
    const pages = paginateMagazine(renderMarkdown(source))
    assert.ok(pages.length >= 2)
    const codePage = pages.find((page) => page.includes('line-0'))
    assert.ok(codePage)
    assert.match(codePage, /<pre><code>/)
    assert.match(pages.at(-1) ?? '', /後続の段落。/)
  })

  it('does not split inside a fenced code block', () => {
    const code = ['```', 'first', 'second', 'third', '```'].join('\n')
    const pages = paginateMagazine(renderMarkdown(`${paragraphs(50)}\n\n${code}`))
    const codePages = pages.filter((page) => page.includes('<pre>'))
    assert.equal(codePages.length, 1)
    assert.match(codePages[0] ?? '', /first\nsecond\nthird/)
  })

  it('paginates around spanning rules, lists, and quotes', () => {
    const source = `## 節

導入の段落。

### 小見出し

> 引用の本文です。

- 一つ
- 二つ

1. 番号
2. 続き

---

${paragraphs(50)}`
    const pages = paginateMagazine(renderMarkdown(source))
    assert.ok(pages.length >= 2)
    const joined = pages.join('\n')
    assert.match(joined, /<h2>節<\/h2>/)
    assert.match(joined, /<h3>小見出し<\/h3>/)
    assert.match(joined, /<blockquote>/)
    assert.match(joined, /<ul>/)
    assert.match(joined, /<ol>/)
    assert.match(joined, /<hr>/)
  })

  it('walks nested blockquotes as one block', () => {
    const html = '<blockquote>\n<blockquote>\n<p>内側</p>\n</blockquote>\n</blockquote>'
    const pages = paginateMagazine(html)
    assert.equal(pages.length, 1)
    assert.equal(pages[0], html)
  })

  it('treats leftover text and void tags as blocks', () => {
    const pages = paginateMagazine('前置<hr/><br><p>後</p>')
    assert.equal(pages.length, 1)
    assert.match(pages[0] ?? '', /前置/)
    assert.match(pages[0] ?? '', /<hr\/>/)
    assert.match(pages[0] ?? '', /<p>後<\/p>/)
    assert.equal(paginateMagazine('タグのない文章')[0], 'タグのない文章')
    assert.match(paginateMagazine('\u00a0<p>本文</p>')[0] ?? '', /本文/)
  })

  it('takes the rest of the input when a tag is unclosed', () => {
    const pages = paginateMagazine('<p>閉じない')
    assert.equal(pages[0], '<p>閉じない')
    const noGt = paginateMagazine('<p')
    assert.equal(noGt[0], '<p')
  })

  it('counts hard breaks, empty lists, and unclosed items', () => {
    const withBreak = paginateMagazine('<p>上<br>下</p>')
    assert.match(withBreak[0] ?? '', /<br>/)
    const emptyList = paginateMagazine('<ul></ul>')
    assert.equal(emptyList[0], '<ul></ul>')
    const openItem = paginateMagazine('<ul><li>残り')
    assert.equal(openItem[0], '<ul><li>残り')
  })

  it('ignores markup that is not a real nested tag', () => {
    const html = '<p>not a nested <prefix> tag</p>'
    assert.equal(paginateMagazine(html)[0], html)
  })

  it('accepts comments, attributes, and stray closing tags', () => {
    const html = '<!--注--></p><p class="lead">本文</p>'
    const pages = paginateMagazine(html)
    assert.match(pages[0] ?? '', /本文/)
    assert.equal(paginateMagazine('<p\n>改行</p>')[0], '<p\n>改行</p>')
    assert.equal(paginateMagazine('<p\t>タブ</p>')[0], '<p\t>タブ</p>')
    assert.equal(paginateMagazine('<p\r>復帰</p>')[0], '<p\r>復帰</p>')
  })

  it('counts unknown tags and truncated markup', () => {
    assert.equal(paginateMagazine('<div>箱</div>')[0], '<div>箱</div>')
    assert.match(paginateMagazine('<p>途中<')[0] ?? '', /途中/)
    assert.equal(paginateMagazine('<h3>小</h3>')[0], '<h3>小</h3>')
  })
})

describe('magazine document pages', () => {
  it('renders one paper for a short magazine document', () => {
    const html = renderDocument(renderMarkdown('# 見出し\n\n導入です。'), { mode: 'magazine' })
    assert.equal(papers(html).length, 1)
    assert.match(html, /<article class="typeset cols-2">/)
  })

  it('renders stacked papers for a long magazine document', () => {
    const html = renderDocument(renderMarkdown(paragraphs(90)), { mode: 'magazine' })
    const pageCount = papers(html).length
    assert.ok(pageCount >= 2)
    assert.equal((html.match(/<div class="paper">/g) ?? []).length, pageCount)
    assert.equal((html.match(/短い段落です。/g) ?? []).length, 90)
  })

  it('does not paginate print or web documents', () => {
    const fragment = renderMarkdown(paragraphs(90))
    const print = renderDocument(fragment)
    const web = renderDocument(fragment, { mode: 'web' })
    assert.equal((print.match(/<div class="paper">/g) ?? []).length, 1)
    assert.equal((print.match(/<article class="typeset">/g) ?? []).length, 1)
    assert.equal((web.match(/<article class="article">/g) ?? []).length, 1)
    assert.equal(web.includes('cols-2'), false)
  })

  it('exposes the 40-line page size', () => {
    assert.equal(MAGAZINE_LINES_PER_PAGE, 40)
  })
})

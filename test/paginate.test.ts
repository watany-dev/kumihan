import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { renderMarkdown } from '../src/markdown/render.js'
import {
  MAGAZINE_LINES_PER_PAGE,
  PRINT_LINES_PER_PAGE,
  paginateMagazine,
  paginatePrint,
} from '../src/typesetting/paginate.js'
import { renderDocument } from '../src/typesetting/render-page.js'

function magazinePapers(html: string): string[] {
  return [...html.matchAll(/<article class="typeset cols-2">([\s\S]*?)<\/article>/g)].map(
    (match) => match[1] ?? '',
  )
}

function printPapers(html: string): string[] {
  return [...html.matchAll(/<article class="typeset">([\s\S]*?)<\/article>/g)].map(
    (match) => match[1] ?? '',
  )
}

function paragraphs(count: number): string {
  return Array.from({ length: count }, () => '短い段落です。').join('\n\n')
}

describe('paginateMagazine', () => {
  it('keeps short copy on a single page', () => {
    const pages = paginateMagazine(renderMarkdown('# 見出し\n\n導入です。'))
    assert.equal(pages.length, 1)
    assert.match(pages[0] ?? '', /<h1>見出し<\/h1>/)
  })

  it('returns one empty page for blank input', () => {
    assert.deepEqual(paginateMagazine(''), [''])
    assert.deepEqual(paginateMagazine(' \n\t'), [''])
  })

  it('splits long copy into pages of about 40 lines', () => {
    const pages = paginateMagazine(renderMarkdown(paragraphs(80)))
    assert.ok(pages.length >= 2)
    assert.equal((pages.join('\n').match(/<p>/g) ?? []).length, 80)
  })

  it('does not let a heading swallow the blocks after it', () => {
    const pages = paginateMagazine(renderMarkdown(`# 見出し\n\n## 節\n\n${paragraphs(80)}`))
    assert.ok(pages.length >= 2)
    assert.match(pages[0] ?? '', /<h1>見出し<\/h1>/)
    assert.ok((pages[0] ?? '').split('<p>').length - 1 < 80)
  })

  it('puts an oversized block on its own page', () => {
    const code = ['```', ...Array.from({ length: 80 }, (_, i) => `line-${i}`), '```'].join('\n')
    const pages = paginateMagazine(renderMarkdown(`${paragraphs(8)}\n\n${code}\n\n後続の段落。`))
    const codePage = pages.find((page) => page.includes('line-0'))
    assert.ok(codePage)
    assert.match(codePage, /<pre><code>/)
    assert.match(pages.at(-1) ?? '', /後続の段落。/)
  })

  it('does not split inside a fenced code block', () => {
    const code = ['```', 'first', 'second', 'third', '```'].join('\n')
    const pages = paginateMagazine(renderMarkdown(`${paragraphs(50)}\n\n${code}`))
    assert.equal(pages.filter((page) => page.includes('<pre>')).length, 1)
  })

  it('walks nested blockquotes as one block', () => {
    const html = '<blockquote>\n<blockquote>\n<p>内側</p>\n</blockquote>\n</blockquote>'
    assert.equal(paginateMagazine(html)[0], html)
  })

  it('treats leftover text and void tags as blocks', () => {
    assert.match(paginateMagazine('前置<hr/><p>後</p>')[0] ?? '', /前置/)
    assert.equal(paginateMagazine('タグのない文章')[0], 'タグのない文章')
  })

  it('takes the rest of the input when a tag is unclosed', () => {
    assert.equal(paginateMagazine('<p>閉じない')[0], '<p>閉じない')
    assert.equal(paginateMagazine('<p')[0], '<p')
  })

  it('ignores markup that is not a real nested tag', () => {
    const html = '<p>not a nested <prefix> tag</p>'
    assert.equal(paginateMagazine(html)[0], html)
  })
})

describe('paginatePrint', () => {
  it('keeps short copy on a single page', () => {
    const pages = paginatePrint(renderMarkdown('# 見出し\n\n導入です。'))
    assert.equal(pages.length, 1)
    assert.match(pages[0] ?? '', /<h1>見出し<\/h1>/)
  })

  it('splits long copy into pages of about 24 lines', () => {
    const pages = paginatePrint(renderMarkdown(paragraphs(80)))
    assert.ok(pages.length >= 3)
    assert.equal((pages.join('\n').match(/<p>/g) ?? []).length, 80)
    assert.ok(((pages[0] ?? '').match(/<p>/g) ?? []).length <= PRINT_LINES_PER_PAGE)
  })

  it('puts an oversized block on its own page', () => {
    const code = ['```', ...Array.from({ length: 80 }, (_, i) => `line-${i}`), '```'].join('\n')
    const pages = paginatePrint(renderMarkdown(`${paragraphs(8)}\n\n${code}\n\n後続の段落。`))
    const codePage = pages.find((page) => page.includes('line-0'))
    assert.ok(codePage)
    assert.match(codePage, /<pre><code>/)
    assert.match(pages.at(-1) ?? '', /後続の段落。/)
  })
})

describe('magazine document pages', () => {
  it('renders stacked papers for a long magazine document', () => {
    const html = renderDocument(renderMarkdown(paragraphs(90)), { mode: 'magazine' })
    assert.ok(magazinePapers(html).length >= 2)
    assert.equal((html.match(/短い段落です。/g) ?? []).length, 90)
  })

  it('exposes the 40-line page size', () => {
    assert.equal(MAGAZINE_LINES_PER_PAGE, 40)
  })
})

describe('print document pages', () => {
  it('renders stacked papers for a long print document', () => {
    const html = renderDocument(renderMarkdown(paragraphs(90)))
    assert.ok(printPapers(html).length >= 3)
    assert.equal((html.match(/短い段落です。/g) ?? []).length, 90)
    assert.equal(html.includes('cols-2'), false)
  })

  it('does not paginate web documents', () => {
    const fragment = renderMarkdown(paragraphs(90))
    assert.equal(renderDocument(fragment, { mode: 'web' }).includes('class="paper"'), false)
    assert.equal(renderDocument(fragment, { mode: 'web' }).includes('cols-2'), false)
  })

  it('exposes the 24-line page size', () => {
    assert.equal(PRINT_LINES_PER_PAGE, 24)
  })
})

import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { renderMarkdown } from '../src/markdown/render.js'
import {
  MAGAZINE_LINES_PER_PAGE,
  PRINT_LINES_PER_PAGE,
  paginate,
} from '../src/typesetting/paginate.js'
import { renderDocument } from '../src/typesetting/render-page.js'

function papers(html: string, articleClass: string): string[] {
  return [
    ...html.matchAll(new RegExp(`<article class="${articleClass}">([\\s\\S]*?)</article>`, 'g')),
  ].map((match) => match[1] ?? '')
}

// 「何行と数えたか」は、後ろに 1 行の段落を並べて何個同じ頁に入るかで分かります。
// 頁の大きさを 100 行にしておけば、入った段落の数を 100 から引いた値が
// その原稿の行数です。
function countedLines(markdown: string): number {
  const size = 100
  const filler = Array.from({ length: size }, () => 'x').join('\n\n')
  const first = paginate(renderMarkdown(`${markdown}\n\n${filler}`), size)[0] ?? ''
  return size - (first.match(/<p>x<\/p>/g) ?? []).length
}

function paragraphs(count: number): string {
  return Array.from({ length: count }, () => '短い段落です。').join('\n\n')
}

describe('paginate', () => {
  it('keeps short copy on a single page', () => {
    const pages = paginate(renderMarkdown('# 見出し\n\n導入です。'), MAGAZINE_LINES_PER_PAGE)
    assert.equal(pages.length, 1)
    assert.match(pages[0] ?? '', /<h1>見出し<\/h1>/)
  })

  it('returns one empty page for blank input', () => {
    assert.deepEqual(paginate('', MAGAZINE_LINES_PER_PAGE), [''])
    assert.deepEqual(paginate(' \n\t', MAGAZINE_LINES_PER_PAGE), [''])
  })

  it('splits long copy into pages of about 40 lines', () => {
    const pages = paginate(renderMarkdown(paragraphs(80)), MAGAZINE_LINES_PER_PAGE)
    assert.ok(pages.length >= 2)
    assert.equal((pages.join('\n').match(/<p>/g) ?? []).length, 80)
  })

  it('splits long copy into pages of about 24 lines', () => {
    const pages = paginate(renderMarkdown(paragraphs(80)), PRINT_LINES_PER_PAGE)
    assert.ok(pages.length >= 3)
    assert.equal((pages.join('\n').match(/<p>/g) ?? []).length, 80)
    assert.ok(((pages[0] ?? '').match(/<p>/g) ?? []).length <= PRINT_LINES_PER_PAGE)
  })

  it('does not let a heading swallow the blocks after it', () => {
    const pages = paginate(
      renderMarkdown(`# 見出し\n\n## 節\n\n${paragraphs(80)}`),
      MAGAZINE_LINES_PER_PAGE,
    )
    assert.ok(pages.length >= 2)
    assert.match(pages[0] ?? '', /<h1>見出し<\/h1>/)
    assert.ok((pages[0] ?? '').split('<p>').length - 1 < 80)
  })

  it('puts an oversized block on its own page', () => {
    const code = ['```', ...Array.from({ length: 80 }, (_, i) => `line-${i}`), '```'].join('\n')
    const pages = paginate(
      renderMarkdown(`${paragraphs(8)}\n\n${code}\n\n後続の段落。`),
      MAGAZINE_LINES_PER_PAGE,
    )
    const codePage = pages.find((page) => page.includes('line-0'))
    assert.ok(codePage)
    assert.match(codePage, /<pre><code>/)
    assert.match(pages.at(-1) ?? '', /後続の段落。/)
  })

  it('does not split inside a fenced code block', () => {
    const code = ['```', 'first', 'second', 'third', '```'].join('\n')
    const pages = paginate(renderMarkdown(`${paragraphs(50)}\n\n${code}`), MAGAZINE_LINES_PER_PAGE)
    assert.equal(pages.filter((page) => page.includes('<pre>')).length, 1)
  })

  it('walks nested blockquotes as one block', () => {
    const html = '<blockquote>\n<blockquote>\n<p>内側</p>\n</blockquote>\n</blockquote>'
    assert.equal(paginate(html, MAGAZINE_LINES_PER_PAGE)[0], html)
  })

  it('treats leftover text and void tags as blocks', () => {
    assert.match(paginate('前置<hr/><p>後</p>', MAGAZINE_LINES_PER_PAGE)[0] ?? '', /前置/)
    assert.equal(paginate('タグのない文章', MAGAZINE_LINES_PER_PAGE)[0], 'タグのない文章')
  })

  it('does not let a bare img swallow the rest of the page', () => {
    const pages = paginate('<img src="a.png" alt="x">\n<p>後</p>', 1)
    assert.equal(pages.length, 2)
    assert.equal(pages[0], '<img src="a.png" alt="x">')
    assert.equal(pages[1], '<p>後</p>')
  })

  it('takes the rest of the input when a tag is unclosed', () => {
    assert.equal(paginate('<p>閉じない', MAGAZINE_LINES_PER_PAGE)[0], '<p>閉じない')
    assert.equal(paginate('<p', MAGAZINE_LINES_PER_PAGE)[0], '<p')
    // 閉じタグを探しているあいだに `<` だけが残って入力が尽きる形。
    assert.equal(paginate('<p>あと<', MAGAZINE_LINES_PER_PAGE)[0], '<p>あと<')
  })

  it('does not read a non-name after < as a tag', () => {
    // `<` の次がタグ名でなければ、その `>` までで 1 ブロック。閉じは探しません。
    assert.deepEqual(paginate('<1>本文', MAGAZINE_LINES_PER_PAGE), ['<1>\n本文'])
    assert.deepEqual(paginate('< p>本文', MAGAZINE_LINES_PER_PAGE), ['< p>\n本文'])
  })

  it('starts a block at a stray closing tag', () => {
    assert.equal(paginate('</p>あと', MAGAZINE_LINES_PER_PAGE)[0], '</p>あと')
  })

  it('counts the lines a block is actually set in', () => {
    // 組まれる行数と一致すること。囲みタグ（<ul> や <table>）はそれ自体では
    // 何も組まれないので数えず、強制改行の <br> は 1 行として数えます。
    assert.equal(countedLines('ああ'), 1)
    assert.equal(countedLines('# 見出し'), 1)
    assert.equal(countedLines('ああ\n\nいい\n\nうう'), 3)
    assert.equal(countedLines('- a\n- b\n- c\n- d\n- e'), 5)
    assert.equal(countedLines('1. a\n2. b\n3. c'), 3)
    assert.equal(countedLines('> a\n>\n> b\n>\n> c'), 3)
    assert.equal(countedLines('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'), 3)
    assert.equal(countedLines('```\na\nb\nc\n```'), 3)
    assert.equal(countedLines('![a](b.png)'), 1)
    assert.equal(countedLines('---'), 1)
  })

  it('counts a hard break as a line', () => {
    // 行末 2 スペースの強制改行は HTML の改行を作りません。1 行と数えたままだと、
    // 高さが 40 行に固定された 2 段組の紙から詩や住所があふれます。
    assert.equal(countedLines('a  \nb  \nc  \nd  \ne'), 5)
    const pages = paginate(renderMarkdown('a  \nb  \nc\n\n' + paragraphs(10)), 5)
    assert.ok(pages.length >= 3)
    assert.match(pages[0] ?? '', /<p>a<br>b<br>c<\/p>/)
    // 3 行の段落と 1 行の段落 2 つで 5 行。残りは次の頁へ。
    assert.equal(((pages[0] ?? '').match(/短い段落です。/g) ?? []).length, 2)
  })

  it('does not count wrapper tags that set no line', () => {
    // 5 項目の箇条書きは 5 行。囲みの <ul> と </ul> まで数えると 7 行になり、
    // 頁が早く切れて紙が空きます。
    const pages = paginate(renderMarkdown(`- a\n- b\n- c\n- d\n- e\n\n${paragraphs(3)}`), 8)
    assert.equal(pages.length, 1)
  })

  it('ignores markup that is not a real nested tag', () => {
    const html = '<p>not a nested <prefix> tag</p>'
    assert.equal(paginate(html, MAGAZINE_LINES_PER_PAGE)[0], html)
  })
})

describe('magazine document pages', () => {
  it('renders stacked papers for a long magazine document', () => {
    const html = renderDocument(renderMarkdown(paragraphs(90)), { mode: 'magazine' })
    assert.ok(papers(html, 'typeset cols-2').length >= 2)
    assert.equal((html.match(/短い段落です。/g) ?? []).length, 90)
  })

  it('exposes the 40-line page size', () => {
    assert.equal(MAGAZINE_LINES_PER_PAGE, 40)
  })
})

describe('print document pages', () => {
  it('renders stacked papers for a long print document', () => {
    const html = renderDocument(renderMarkdown(paragraphs(90)))
    assert.ok(papers(html, 'typeset').length >= 3)
    assert.equal((html.match(/短い段落です。/g) ?? []).length, 90)
    assert.equal(html.includes('cols-2'), false)
  })

  it('does not paginate web documents', () => {
    const fragment = renderMarkdown(paragraphs(90))
    assert.equal(renderDocument(fragment, { mode: 'web' }).includes('class="paper"'), false)
    assert.equal(renderDocument(fragment, { mode: 'web' }).includes('cols-2'), false)
  })
})

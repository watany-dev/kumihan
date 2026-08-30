import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { renderMarkdown } from '../src/markdown/render.js'
import type { Measure } from '../src/typesetting/paginate.js'
import {
  MAGAZINE_LINES_PER_PAGE,
  MAGAZINE_MEASURE,
  PRINT_LINES_PER_PAGE,
  PRINT_MEASURE,
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
function countedLines(markdown: string, measure?: Measure): number {
  const size = 100
  const filler = Array.from({ length: size }, () => 'x').join('\n\n')
  const first = paginate(renderMarkdown(`${markdown}\n\n${filler}`), size, measure)[0] ?? ''
  return size - (first.match(/<p>x<\/p>/g) ?? []).length
}

// 原稿を通さない断片を数えるとき。renderMarkdown が出さない書き方（実体参照に
// ならない `&` など）は、こちらで直に渡します。
function countedFragmentLines(fragment: string, measure?: Measure): number {
  const size = 100
  const filler = Array.from({ length: size }, () => '<p>x</p>').join('\n')
  const first = paginate(`${fragment}\n${filler}`, size, measure)[0] ?? ''
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

describe('wrapped lines', () => {
  it('divides the run of text by the measure', () => {
    // 1段は 42 字詰。ちょうど収まるうちは 1 行で、1 字あふれると 2 行です。
    assert.equal(countedLines('あ'.repeat(42), PRINT_MEASURE), 1)
    assert.equal(countedLines('あ'.repeat(43), PRINT_MEASURE), 2)
    assert.equal(countedLines('あ'.repeat(84), PRINT_MEASURE), 2)
    assert.equal(countedLines('あ'.repeat(85), PRINT_MEASURE), 3)
    // 2段の段は 22 字詰。
    assert.equal(countedLines('あ'.repeat(22), MAGAZINE_MEASURE), 1)
    assert.equal(countedLines('あ'.repeat(23), MAGAZINE_MEASURE), 2)
  })

  it('counts ASCII as half a character', () => {
    assert.equal(countedLines('a'.repeat(84), PRINT_MEASURE), 1)
    assert.equal(countedLines('a'.repeat(85), PRINT_MEASURE), 2)
    // 全角と半角の混在。全角 21 字 + 半角 42 字でちょうど 42 字ぶん。
    assert.equal(countedLines(`${'あ'.repeat(21)}${'a'.repeat(42)}`, PRINT_MEASURE), 1)
    assert.equal(countedLines(`${'あ'.repeat(21)}${'a'.repeat(43)}`, PRINT_MEASURE), 2)
    // 半角カナは半角。
    assert.equal(countedLines('ｱ'.repeat(84), PRINT_MEASURE), 1)
    assert.equal(countedLines('ｱ'.repeat(85), PRINT_MEASURE), 2)
  })

  it('counts an entity as the one character it is set as', () => {
    // `&` は HTML では `&amp;` の 5 文字ですが、紙に組まれるのは 1 字です。
    assert.equal(countedLines('&'.repeat(84), PRINT_MEASURE), 1)
    assert.equal(countedLines('&'.repeat(85), PRINT_MEASURE), 2)
    assert.equal(countedLines('"'.repeat(84), PRINT_MEASURE), 1)
    assert.equal(countedLines(`${'あ'.repeat(41)}&`, PRINT_MEASURE), 1)
    assert.equal(countedLines(`${'あ'.repeat(42)}&`, PRINT_MEASURE), 2)
  })

  it('counts an ampersand that is not an entity as itself', () => {
    // `&` のあとに `;` が来なければ実体参照ではないので、`&` 1 字として数えます。
    assert.equal(countedFragmentLines(`<p>${'&'.repeat(84)}</p>`, PRINT_MEASURE), 1)
    assert.equal(countedFragmentLines(`<p>${'&'.repeat(85)}</p>`, PRINT_MEASURE), 2)
    assert.equal(countedFragmentLines(`<p>${'&; '.repeat(28)}</p>`, PRINT_MEASURE), 1)
    assert.equal(countedFragmentLines(`<p>${'& '.repeat(42)}</p>`, PRINT_MEASURE), 1)
    assert.equal(countedFragmentLines(`<p>${'& '.repeat(43)}</p>`, PRINT_MEASURE), 2)
    // `;` が遠すぎるものも実体参照ではありません。
    assert.equal(countedFragmentLines(`<p>&${'a'.repeat(83)};</p>`, PRINT_MEASURE), 2)
  })

  it('counts a surrogate pair as one character', () => {
    // 追加面の文字は 2 コードユニットですが、組まれるのは全角 1 字です。
    assert.equal(countedLines('𠮷'.repeat(42), PRINT_MEASURE), 1)
    assert.equal(countedLines('𠮷'.repeat(43), PRINT_MEASURE), 2)
  })

  it('wraps each hard-broken line on its own', () => {
    const long = 'あ'.repeat(43)
    assert.equal(countedLines(`${long}  \n${long}`, PRINT_MEASURE), 4)
  })

  it('does not count the markup inside a tag', () => {
    // 属性は組まれません。長い URL のリンクでも、組まれるのは文字列のほうです。
    const link = `[${'あ'.repeat(40)}](https://example.com/${'a'.repeat(200)})`
    assert.equal(countedLines(link, PRINT_MEASURE), 1)
    assert.equal(countedLines(`![${'a'.repeat(200)}](b.png)`, PRINT_MEASURE), 1)
  })

  it('wraps a heading by its own size', () => {
    // 見出しは 18pt で本文の 1.7 倍あるので、24 字あたりで折り返します。
    assert.equal(countedLines(`# ${'あ'.repeat(24)}`, PRINT_MEASURE), 1)
    assert.equal(countedLines(`# ${'あ'.repeat(25)}`, PRINT_MEASURE), 2)
    assert.equal(countedLines(`## ${'あ'.repeat(32)}`, PRINT_MEASURE), 1)
    assert.equal(countedLines(`## ${'あ'.repeat(33)}`, PRINT_MEASURE), 2)
    assert.equal(countedLines('# 見出し', PRINT_MEASURE), 1)
  })

  it('narrows a list and a blockquote by their indent', () => {
    // `ul` の padding-left は 1.5em なので、字詰は 42 ではなく 40.5 字です。
    assert.equal(countedLines(`- ${'あ'.repeat(40)}`, PRINT_MEASURE), 1)
    assert.equal(countedLines(`- ${'あ'.repeat(41)}`, PRINT_MEASURE), 2)
    assert.equal(countedLines(`> ${'あ'.repeat(40)}`, PRINT_MEASURE), 1)
    assert.equal(countedLines(`> ${'あ'.repeat(41)}`, PRINT_MEASURE), 2)
    // 短い箇条書きは今までどおり項目の数だけ。
    assert.equal(countedLines('- a\n- b\n- c\n- d\n- e', PRINT_MEASURE), 5)
  })

  it('counts a table row by its widest cell', () => {
    const wide = 'あ'.repeat(30)
    // 2 列の表なので、1 セルの字詰は半分の 21 字弱。30 字のセルは 2 行になります。
    assert.equal(countedLines(`| a | b |\n| --- | --- |\n| ${wide} | x |`, PRINT_MEASURE), 3)
    assert.equal(countedLines('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |', PRINT_MEASURE), 3)
  })

  it('counts code by the size it is set in', () => {
    // `pre` は 0.92em なので、本文より少し多く入ります。
    assert.equal(countedLines(['```', 'a'.repeat(91), '```'].join('\n'), PRINT_MEASURE), 1)
    assert.equal(countedLines(['```', 'a'.repeat(92), '```'].join('\n'), PRINT_MEASURE), 2)
  })

  it('gives the width of the paper to blocks that span the columns', () => {
    // 2段でも h1・その直後のリード・pre・図は段を抜くので、22 字ではなく 46 字詰。
    assert.equal(countedLines(`# ${'あ'.repeat(24)}`, MAGAZINE_MEASURE), 1)
    assert.equal(countedLines(['```', 'a'.repeat(99), '```'].join('\n'), MAGAZINE_MEASURE), 1)
    assert.equal(countedLines(`# 見出し\n\n${'あ'.repeat(46)}`, MAGAZINE_MEASURE), 2)
    // リードでない段落は段の幅（22 字）のまま。
    assert.equal(countedLines(`## 節\n\n${'あ'.repeat(46)}`, MAGAZINE_MEASURE), 4)
  })

  it('keeps counting one line per block without a measure', () => {
    // 字詰を渡さなければ、折り返しを見ない今までの数え方です。
    assert.equal(countedLines('あ'.repeat(400)), 1)
    assert.equal(countedLines(`# ${'あ'.repeat(400)}`), 1)
  })

  it('keeps long copy inside the fixed height of a magazine page', () => {
    // issue #33 の完了条件。2段の紙は高さが決まっていて、あふれた分は消えます。
    const paragraph = 'あ'.repeat(400)
    const perParagraph = Math.ceil(400 / MAGAZINE_MEASURE.charsPerLine)
    const pages = paginate(
      renderMarkdown(Array.from({ length: 30 }, () => paragraph).join('\n\n')),
      MAGAZINE_LINES_PER_PAGE,
      MAGAZINE_MEASURE,
    )

    assert.ok(pages.length >= 15)
    assert.equal((pages.join('\n').match(/<p>/g) ?? []).length, 30)
    for (const page of pages) {
      const lines = (page.match(/<p>/g) ?? []).length * perParagraph
      assert.ok(lines <= MAGAZINE_LINES_PER_PAGE, `${lines} 行は紙に入らない`)
    }
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

  it('measures the wrapping of long paragraphs', () => {
    // renderDocument が字詰を渡していること。長い段落だけの原稿は、折り返しを
    // 数えないと 1 枚に収まってしまい、紙からあふれた分が消えます。
    const long = Array.from({ length: 30 }, () => 'あ'.repeat(400)).join('\n\n')
    const html = renderDocument(renderMarkdown(long), { mode: 'magazine' })
    assert.ok(papers(html, 'typeset cols-2').length >= 15)
  })
})

describe('print document pages', () => {
  it('renders stacked papers for a long print document', () => {
    const html = renderDocument(renderMarkdown(paragraphs(90)))
    assert.ok(papers(html, 'typeset').length >= 3)
    assert.equal((html.match(/短い段落です。/g) ?? []).length, 90)
    assert.equal(html.includes('cols-2'), false)
  })

  it('exposes the print measure', () => {
    assert.equal(PRINT_LINES_PER_PAGE, 24)
    assert.equal(PRINT_MEASURE.charsPerLine, 42)
  })

  it('does not paginate web documents', () => {
    const fragment = renderMarkdown(paragraphs(90))
    assert.equal(renderDocument(fragment, { mode: 'web' }).includes('class="paper"'), false)
    assert.equal(renderDocument(fragment, { mode: 'web' }).includes('cols-2'), false)
  })
})

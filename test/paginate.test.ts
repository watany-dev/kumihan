import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { renderMarkdown } from '../src/markdown/render.js'
import {
  MAGAZINE_COLUMN_LINES,
  MAGAZINE_LAYOUT,
  type PageLayout,
  PRINT_LAYOUT,
  blockLines,
  imageMaxLines,
  paginate,
} from '../src/typesetting/paginate.js'
import { renderDocument } from '../src/typesetting/render-page.js'
import { typesetCss } from '../src/typesetting/typeset.css.js'

function papers(html: string, articleClass: string): string[] {
  return [
    ...html.matchAll(new RegExp(`<article class="${articleClass}">([\\s\\S]*?)</article>`, 'g')),
  ].map((match) => match[1] ?? '')
}

/** 行数だけを変えた 1段の頁。詰め込みの順番を見るテストが使います。 */
function sized(lines: number): PageLayout {
  return { ...MAGAZINE_LAYOUT, lines, columns: 1 }
}

/** ブロック 1 つの組み上がりの高さ（本文行）。 */
function height(markdown: string, layout: PageLayout = MAGAZINE_LAYOUT): number {
  return blockLines(renderMarkdown(markdown), layout)
}

/** 段落の下の余白。組み上がりの高さはどれもこれを含みます。 */
const PARAGRAPH_MARGIN = 0.9 / MAGAZINE_LAYOUT.lineHeight

function paragraphs(count: number): string {
  return Array.from({ length: count }, () => '短い段落です。').join('\n\n')
}

/** 全角 n 字の段落。2段組の段には 24 字入ります。 */
function fullWidth(count: number): string {
  return Array.from({ length: count }, () => 'あ').join('')
}

/** 同じセルを 2 つ並べた 1 行の表。 */
function twoCellRow(cell: string): string {
  return `| a | b |\n| --- | --- |\n| ${cell} | ${cell} |`
}

/** typeset.css の、あるセレクタのある指定。無ければ空文字。 */
function declaration(selector: string, property: string): string {
  const rule = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(typesetCss)
  const found = new RegExp(`(?:^|;|\\n)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule?.[1] ?? '')
  return (found?.[1] ?? '').trim()
}

/** pt を mm に。 */
function mm(points: number): number {
  return points * 0.352778
}

describe('paginate', () => {
  it('keeps short copy on a single page', () => {
    const pages = paginate(renderMarkdown('# 見出し\n\n導入です。'), MAGAZINE_LAYOUT)
    assert.equal(pages.length, 1)
    assert.match(pages[0] ?? '', /<h1>見出し<\/h1>/)
  })

  it('returns one empty page for blank input', () => {
    assert.deepEqual(paginate('', MAGAZINE_LAYOUT), [''])
    assert.deepEqual(paginate(' \n\t', MAGAZINE_LAYOUT), [''])
  })

  it('splits long copy into pages', () => {
    const pages = paginate(renderMarkdown(paragraphs(120)), MAGAZINE_LAYOUT)
    assert.ok(pages.length >= 2)
    assert.equal((pages.join('\n').match(/<p>/g) ?? []).length, 120)
  })

  it('fits fewer lines on a print page than on a magazine page', () => {
    const source = renderMarkdown(paragraphs(120))
    assert.ok(paginate(source, PRINT_LAYOUT).length > paginate(source, MAGAZINE_LAYOUT).length)
    assert.equal((paginate(source, PRINT_LAYOUT).join('\n').match(/<p>/g) ?? []).length, 120)
  })

  it('does not let a heading swallow the blocks after it', () => {
    const pages = paginate(
      renderMarkdown(`# 見出し\n\n## 節\n\n${paragraphs(120)}`),
      MAGAZINE_LAYOUT,
    )
    assert.ok(pages.length >= 2)
    assert.match(pages[0] ?? '', /<h1>見出し<\/h1>/)
    assert.ok((pages[0] ?? '').split('<p>').length - 1 < 120)
  })

  it('puts an oversized block on its own page', () => {
    const code = ['```', ...Array.from({ length: 120 }, (_, i) => `line-${i}`), '```'].join('\n')
    const pages = paginate(
      renderMarkdown(`${paragraphs(8)}\n\n${code}\n\n後続の段落。`),
      MAGAZINE_LAYOUT,
    )
    const codePage = pages.find((page) => page.includes('line-0'))
    assert.ok(codePage)
    assert.match(codePage, /<pre><code>/)
    assert.match(pages.at(-1) ?? '', /後続の段落。/)
  })

  it('does not split inside a fenced code block', () => {
    const code = ['```', 'first', 'second', 'third', '```'].join('\n')
    const pages = paginate(renderMarkdown(`${paragraphs(60)}\n\n${code}`), MAGAZINE_LAYOUT)
    assert.equal(pages.filter((page) => page.includes('<pre>')).length, 1)
  })

  it('walks nested blockquotes as one block', () => {
    const html = '<blockquote>\n<blockquote>\n<p>内側</p>\n</blockquote>\n</blockquote>'
    assert.equal(paginate(html, MAGAZINE_LAYOUT)[0], html)
  })

  it('treats leftover text and void tags as blocks', () => {
    assert.match(paginate('前置<hr/><p>後</p>', MAGAZINE_LAYOUT)[0] ?? '', /前置/)
    assert.equal(paginate('タグのない文章', MAGAZINE_LAYOUT)[0], 'タグのない文章')
  })

  it('does not let a bare img swallow the rest of the page', () => {
    const pages = paginate('<img src="a.png" alt="x">\n<p>後</p>', sized(1))
    assert.equal(pages.length, 2)
    assert.equal(pages[0], '<img src="a.png" alt="x">')
    assert.equal(pages[1], '<p>後</p>')
  })

  it('takes the rest of the input when a tag is unclosed', () => {
    assert.equal(paginate('<p>閉じない', MAGAZINE_LAYOUT)[0], '<p>閉じない')
    assert.equal(paginate('<p', MAGAZINE_LAYOUT)[0], '<p')
    // 閉じタグを探しているあいだに `<` だけが残って入力が尽きる形。
    assert.equal(paginate('<p>あと<', MAGAZINE_LAYOUT)[0], '<p>あと<')
  })

  it('does not read a non-name after < as a tag', () => {
    // `<` の次がタグ名でなければ、その `>` までで 1 ブロック。閉じは探しません。
    assert.deepEqual(paginate('<1>本文', MAGAZINE_LAYOUT), ['<1>\n本文'])
    assert.deepEqual(paginate('< p>本文', MAGAZINE_LAYOUT), ['< p>\n本文'])
  })

  it('starts a block at a stray closing tag', () => {
    assert.equal(paginate('</p>あと', MAGAZINE_LAYOUT)[0], '</p>あと')
  })

  it('ignores markup that is not a real nested tag', () => {
    const html = '<p>not a nested <prefix> tag</p>'
    assert.equal(paginate(html, MAGAZINE_LAYOUT)[0], html)
  })
})

// 折り返しを数えないと、1 つの段落を 1 行に書く日本語の原稿では組み上がりが
// 桁で外れます。2段組の段は 24 字なので、そこを境に行が増えることを見ます。
describe('block heights', () => {
  it('wraps a paragraph at the width of the column', () => {
    assert.equal(height(fullWidth(24)), 1 + PARAGRAPH_MARGIN)
    assert.equal(height(fullWidth(25)), 2 + PARAGRAPH_MARGIN)
    assert.equal(height(fullWidth(48)), 2 + PARAGRAPH_MARGIN)
    assert.equal(height(fullWidth(49)), 3 + PARAGRAPH_MARGIN)
    // 1段組は 45 字。同じ段落でも組む幅が広ければ行は減ります。
    assert.ok(height(fullWidth(300), PRINT_LAYOUT) < height(fullWidth(300)))
  })

  it('counts half width characters as half a column', () => {
    assert.equal(height('a'.repeat(48)), 1 + PARAGRAPH_MARGIN)
    assert.equal(height('a'.repeat(49)), 2 + PARAGRAPH_MARGIN)
    // 実体参照は 1 字。`&amp;` の 5 文字ぶんは数えません。
    assert.equal(height('&'.repeat(48)), 1 + PARAGRAPH_MARGIN)
  })

  it('counts a hard break as a line', () => {
    // 行末 2 スペースの強制改行は HTML の改行を作りません。1 行と数えたままだと、
    // 高さの決まった 2 段組から詩や住所があふれます。
    assert.equal(height('a  \nb  \nc  \nd  \ne'), 5 + PARAGRAPH_MARGIN)
  })

  it('does not count wrapper tags that set no line', () => {
    // 5 項目の箇条書きは 5 行。囲みの <ul> と </ul> はそれ自体では何も組みません。
    const list = height('- a\n- b\n- c\n- d\n- e')
    assert.ok(list > 5 && list < 6.5, `${list}`)
    assert.equal(height('```\na\nb\nc\n```') > 3, true)
  })

  it('measures a table row by row, sharing the width between columns', () => {
    // 3 行の表は 3 行ぶん。囲みの <table> や <tbody> は何も組みません。
    const short = height('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |')
    assert.ok(short > 3 && short < 5, `${short}`)

    // 長いセルは段の中で折り返すので、同じ行数の表でも高くなります。
    assert.ok(height(twoCellRow(fullWidth(60))) > height(twoCellRow('1')) * 2)
  })

  it('gives every block at least one line', () => {
    assert.equal(height('---') > 0, true)
    assert.equal(blockLines('<div></div>', MAGAZINE_LAYOUT), 1)
  })
})

/** CSS ピクセルを mm に。1px = 1/96 インチ。 */
function px(count: number): number {
  return (count * 25.4) / 96
}

/** 高さ（mm）を本文行に。 */
function rows(heightMm: number, layout: PageLayout): number {
  return heightMm / mm(layout.bodyPoints * layout.lineHeight)
}

/** 段落の下の余白（本文行）。 */
function margin(layout: PageLayout): number {
  return 0.9 / layout.lineHeight
}

/** 実寸を書き入れた図だけの段落。 */
function figure(widthPx: number, heightPx: number): string {
  return `<p><img src="a.png" alt="" width="${widthPx}" height="${heightPx}"></p>`
}

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 0.001, `${actual} !== ${expected}`)
}

// 画像は実寸（`<img>` の width / height、measure-images.ts が書き入れます）から
// 見積もります。原稿に対して実寸のまま組む必要はないので、版面や段より大きい図は
// CSS が縮めます。見積りもそこまで縮んだあとの高さを数えます。
describe('image heights', () => {
  it('takes the height of a figure from the image itself', () => {
    // 版面（170mm）に収まる図は実寸のまま。400×200px は 105.8×52.9mm。
    near(
      blockLines(figure(400, 200), PRINT_LAYOUT),
      margin(PRINT_LAYOUT) + rows(px(200), PRINT_LAYOUT),
    )
    // 縦横比のぶんだけ高くなります。
    near(
      blockLines(figure(400, 400), PRINT_LAYOUT) - margin(PRINT_LAYOUT),
      (blockLines(figure(400, 200), PRINT_LAYOUT) - margin(PRINT_LAYOUT)) * 2,
    )
  })

  it('shrinks a figure wider than the page to fit it', () => {
    // 版面より広い写真は幅いっぱいに縮みます。縦横比が同じなら、元が何倍
    // 大きくても組み上がりは同じ高さです。
    const expected = margin(PRINT_LAYOUT) + rows(PRINT_LAYOUT.textWidthMm / 2, PRINT_LAYOUT)
    near(blockLines(figure(4000, 2000), PRINT_LAYOUT), expected)
    near(blockLines(figure(8000, 4000), PRINT_LAYOUT), expected)
  })

  it('never lets a figure outgrow a column', () => {
    for (const layout of [PRINT_LAYOUT, MAGAZINE_LAYOUT]) {
      const tall = blockLines(figure(100, 100_000), layout)
      near(tall, margin(layout) + imageMaxLines(layout))
      // 余白を足しても段 1 本にちょうど収まる高さ。
      near(tall, layout.lines / layout.columns)
    }
  })

  it('gives a spanning figure the width of the whole page in two columns', () => {
    // 図だけの段落は段を抜くので版面いっぱい、地の文に混ざった図は段の幅まで。
    const spanning = blockLines(figure(1000, 500), MAGAZINE_LAYOUT)
    const inColumn = blockLines(
      '<p>図です。<img src="a.png" alt="" width="1000" height="500"></p>',
      MAGAZINE_LAYOUT,
    )
    near(spanning, margin(MAGAZINE_LAYOUT) + rows(MAGAZINE_LAYOUT.textWidthMm / 2, MAGAZINE_LAYOUT))
    near(
      inColumn,
      margin(MAGAZINE_LAYOUT) + rows(MAGAZINE_LAYOUT.columnWidthMm / 2, MAGAZINE_LAYOUT),
    )
    assert.ok(spanning > inColumn)
  })

  it('counts a figure of unknown size as one line, as before', () => {
    const unknown = 1 + margin(MAGAZINE_LAYOUT)
    assert.equal(blockLines('<p><img src="a.png" alt=""></p>', MAGAZINE_LAYOUT), unknown)
    assert.equal(blockLines(figure(0, 0), MAGAZINE_LAYOUT), unknown)
    assert.equal(
      blockLines('<p><img src="a.png" alt="" width="x" height="y"></p>', MAGAZINE_LAYOUT),
      unknown,
    )
    // 閉じないタグでも数え続けない。
    assert.equal(blockLines('<p><img src="a.png"', MAGAZINE_LAYOUT), unknown)
    // 実寸が本文 1 行より低い図は、その 1 行のまま。
    assert.equal(blockLines(figure(8, 8), MAGAZINE_LAYOUT), unknown)
  })

  it('moves a figure that no longer fits to the next page', () => {
    const text = renderMarkdown(paragraphs(10))
    const small = paginate(`${text}\n${figure(200, 200)}`, PRINT_LAYOUT)
    assert.equal(small.length, 1)
    // 頁の高さいっぱいの図は、前の頁に残った空きには入りません。
    const large = paginate(`${text}\n${figure(2000, 4000)}`, PRINT_LAYOUT)
    assert.equal(large.length, 2)
    assert.match(large[1] ?? '', /<img/)
  })
})

// 見積りは組版指定から割り出しています。CSS だけを動かすと頁があふれるので、
// 両者が同じ数字を見ていることを確かめます。
describe('page layout matches the stylesheet', () => {
  it('takes the paper and the type size from typeset.css', () => {
    assert.equal(declaration('.paper', 'width'), '210mm')
    assert.equal(declaration('.paper', 'min-height'), '297mm')
    assert.equal(declaration('.paper', 'padding'), '22mm 20mm 24mm')
    assert.equal(declaration('.typeset', 'font-size'), `${PRINT_LAYOUT.bodyPoints}pt`)
    assert.equal(declaration('.typeset', 'line-height'), `${PRINT_LAYOUT.lineHeight}`)
  })

  it('takes the columns from typeset.css', () => {
    assert.equal(declaration('.typeset.cols-2', 'column-count'), `${MAGAZINE_LAYOUT.columns}`)
    assert.equal(declaration('.typeset.cols-2', 'column-gap'), '8mm')
    assert.equal(declaration('.typeset.cols-2', 'font-size'), `${MAGAZINE_LAYOUT.bodyPoints}pt`)
    assert.equal(declaration('.typeset.cols-2', 'line-height'), `${MAGAZINE_LAYOUT.lineHeight}`)
  })

  it('leaves the column height as a floor, so an over-full page grows instead of spilling', () => {
    // height だと、入りきらない中身は段の右外に並んで紙からはみ出します。
    assert.equal(declaration('.typeset.cols-2', 'height'), '')
    assert.equal(
      declaration('.typeset.cols-2', 'min-height'),
      `calc(${MAGAZINE_COLUMN_LINES} * ${MAGAZINE_LAYOUT.lineHeight}em)`,
    )
    assert.equal(MAGAZINE_LAYOUT.lines, MAGAZINE_COLUMN_LINES * MAGAZINE_LAYOUT.columns)
  })

  it('caps a figure at the height typeset.css allows', () => {
    // `img { max-height }` は段 1 本から段落の余白を引いた高さ。頁分けの
    // imageMaxLines がこれとずれると、図のある頁が紙からあふれます。
    const maxHeight = (selector: string, layout: PageLayout): number => {
      const found = /calc\((\d+(?:\.\d+)?) \* (\d+(?:\.\d+)?)em - (\d+(?:\.\d+)?)em\)/.exec(
        declaration(selector, 'max-height'),
      )
      assert.ok(found !== null, `no max-height for ${selector}`)
      return (Number(found[1]) * Number(found[2]) - Number(found[3])) / layout.lineHeight
    }

    for (const [selector, layout] of [
      ['.typeset img', PRINT_LAYOUT],
      ['.typeset.cols-2 img', MAGAZINE_LAYOUT],
    ] as const) {
      assert.ok(Math.abs(maxHeight(selector, layout) - imageMaxLines(layout)) < 0.001)
    }

    assert.equal(declaration('.typeset img', 'max-width'), '100%')
    // 実寸の属性が幅と高さを決めてしまわないよう、どちらも auto に戻します。
    // width を戻し忘れると、max-height で切り詰めた図がゆがみます。
    assert.equal(declaration('.typeset img', 'width'), 'auto')
    assert.equal(declaration('.typeset img', 'height'), 'auto')
  })

  it('fits the type on the paper', () => {
    // 版面（297 − 22 − 24 = 251mm）に、その行数がちょうど収まること。
    for (const layout of [PRINT_LAYOUT, MAGAZINE_LAYOUT]) {
      const columnLines = layout.lines / layout.columns
      assert.ok(columnLines * mm(layout.bodyPoints * layout.lineHeight) <= 251)
      assert.ok(layout.columnChars * mm(layout.bodyPoints) <= 170)
    }
  })
})

describe('magazine document pages', () => {
  it('renders stacked papers for a long magazine document', () => {
    const html = renderDocument(renderMarkdown(paragraphs(140)), { mode: 'magazine' })
    assert.ok(papers(html, 'typeset cols-2').length >= 2)
    assert.equal((html.match(/短い段落です。/g) ?? []).length, 140)
  })

  it('exposes the column height', () => {
    assert.equal(MAGAZINE_COLUMN_LINES, 40)
    assert.equal(MAGAZINE_LAYOUT.columnChars, 24)
  })
})

describe('print document pages', () => {
  it('renders stacked papers for a long print document', () => {
    const html = renderDocument(renderMarkdown(paragraphs(140)))
    assert.ok(papers(html, 'typeset').length >= 3)
    assert.equal((html.match(/短い段落です。/g) ?? []).length, 140)
    assert.equal(html.includes('cols-2'), false)
  })

  it('does not paginate web documents', () => {
    const fragment = renderMarkdown(paragraphs(90))
    assert.equal(renderDocument(fragment, { mode: 'web' }).includes('class="paper"'), false)
    assert.equal(renderDocument(fragment, { mode: 'web' }).includes('cols-2'), false)
  })
})

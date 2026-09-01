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

/** 規則を読むだけなので、注釈は先に落としておきます。 */
const styleRules = typesetCss.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * typeset.css の、あるセレクタのある指定。無ければ空文字。
 *
 * 同じセレクタは複数の規則に出ます（見出しは行送りをまとめた規則と、級数と
 * 余白をそれぞれ持つ規則）。まとめた規則をセレクタで引けるよう、`,` で並んだ
 * ものも見て、その指定を持つ規則を返します。
 */
function declaration(selector: string, property: string): string {
  for (const rule of styleRules.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const listed = (rule[1] ?? '').split(',').map((one) => one.trim())
    if (!listed.includes(selector)) {
      continue
    }
    const found = new RegExp(`(?:^|;|\\n)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule[2] ?? '')
    if (found !== null) {
      return (found[1] ?? '').trim()
    }
  }
  return ''
}

/** pt を mm に。 */
function mm(points: number): number {
  return points * 0.352778
}

/** `13.5pt` や `1.8em` のような指定の数。 */
function unit(value: string): number {
  return Number.parseFloat(value)
}

/** `1.8em 0 0.7em` のような指定の、上と下。 */
function vertical(shorthand: string): { top: number; bottom: number } {
  const parts = shorthand.split(/\s+/).map(unit)
  return { top: parts[0] ?? 0, bottom: parts[2] ?? parts[0] ?? 0 }
}

/** その要素の em を本文行に。points はその要素の級数。 */
function emLines(em: number, points: number, layout: PageLayout): number {
  return (em * points) / (layout.bodyPoints * layout.lineHeight)
}

/** その要素の級数（pt）。`0.92em` のように本文からの倍率で書いたものも読む。 */
function typePoints(selector: string, layout: PageLayout): number {
  const size = declaration(selector, 'font-size')
  return size.endsWith('em') ? unit(size) * layout.bodyPoints : unit(size)
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

  it('counts every East Asian wide character as a full column width', () => {
    // 全角として組まれる符号位置は漢字と仮名だけではありません。半角と数え違えると、
    // ハングルや全角英数、絵文字などを含む段落だけ組み上がりが半分に見積もられます。
    const wide = [
      'ᄀ', // U+1100 ハングル字母
      '⺀', // U+2E80 康熙部首補助
      'あ', // U+3041 ひらがな
      '㐀', // U+3400 CJK 拡張 A
      '漢', // U+4E00 CJK 統合漢字
      'ꀀ', // U+A000 イ文字
      '가', // U+AC00 ハングル音節
      '𠀋', // U+2000B サロゲート対（先頭で 2 字、続きは 0 字）
      '豈', // U+F900 CJK 互換漢字
      '︐', // U+FE10 縦書き用の約物
      'Ａ', // U+FF21 全角英数
      '￥', // U+FFE5 全角記号
    ]
    for (const char of wide) {
      assert.equal(height(char.repeat(24)), 1 + PARAGRAPH_MARGIN, char)
      assert.equal(height(char.repeat(25)), 2 + PARAGRAPH_MARGIN, char)
    }

    // 半角として組まれるものは、同じ 0x1100 より上でも 24 字では折り返しません。
    assert.equal(height('–'.repeat(25)), 1 + PARAGRAPH_MARGIN)
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

  it('keeps counting when the HTML is not shaped like renderer output', () => {
    // 頁分けが受け取るのは renderMarkdown の出力だけですが、数え方は走査で書いて
    // あるので、閉じないタグや行のない表でも投げずに数え切る必要があります。
    // 数え損ねれば、その頁だけが静かにあふれます。
    const oneRow = blockLines('<table><tr><td>a</td></tr></table>', MAGAZINE_LAYOUT)

    // 行のない表は表として数えず、地の文として数えます（この場合は 0 行）。
    assert.ok(blockLines('<table></table>', MAGAZINE_LAYOUT) < oneRow)
    assert.equal(
      blockLines('<table><tr', MAGAZINE_LAYOUT),
      blockLines('<table></table>', MAGAZINE_LAYOUT),
    )
    assert.ok(
      blockLines('<table>a', MAGAZINE_LAYOUT) > blockLines('<table></table>', MAGAZINE_LAYOUT),
    )
    // 閉じないまま終わった行も、1 行ぶんは取ります。
    assert.equal(blockLines('<table><tr><td>' + fullWidth(60), MAGAZINE_LAYOUT), oneRow)
    // セルの中の改行は、組まれるときに潰れるので幅を取りません。
    assert.equal(blockLines('<table><tr><td>a\nb</td></tr></table>', MAGAZINE_LAYOUT), oneRow)

    // 実体参照になり損ねた `&` は、そのまま 1 字ぶんの幅です。
    assert.equal(blockLines('<p>&;</p>', MAGAZINE_LAYOUT), blockLines('<p>a;</p>', MAGAZINE_LAYOUT))
    assert.equal(
      blockLines('<p>&amp<p>', MAGAZINE_LAYOUT),
      blockLines('<p>aamp<p>', MAGAZINE_LAYOUT),
    )
    assert.equal(
      blockLines('<p>& x</p>', MAGAZINE_LAYOUT),
      blockLines('<p>a x</p>', MAGAZINE_LAYOUT),
    )
    assert.equal(blockLines('<table><tr><td>&</td></tr></table>', MAGAZINE_LAYOUT), oneRow)

    // タグで始まらない断片も、1 ブロックとして頁に入ります。
    assert.deepEqual(paginate('a', MAGAZINE_LAYOUT), ['a'])
  })

  it('gives every block at least one line', () => {
    assert.equal(height('---') > 0, true)
    assert.equal(blockLines('<div></div>', MAGAZINE_LAYOUT), 1)
  })
})

// ブロックの高さは種類ごとに違います。18pt の見出しも、上下に 1em の詰めを持つ
// コードも、本文 1 行として数えていた頃は、見出しが紙の下端をまたぎ、コードの
// 前後で紙が空きました。組み上がりは typeset.css の指定そのものなので、
// 見積りが CSS と同じ数字を見ていることを、ブロックの種類ごとに確かめます。
describe('block heights match the stylesheet', () => {
  it('takes a heading from its type size, its margins and its rule', () => {
    // 見出し 3 つの行送りは 1 つの規則にまとめてあります（最後の .typeset h3 で引く）。
    const headingLineHeight = unit(declaration('.typeset h3', 'line-height'))

    for (const [tag, marker] of [
      ['h1', '# '],
      ['h2', '## '],
      ['h3', '### '],
    ] as const) {
      for (const layout of [PRINT_LAYOUT, MAGAZINE_LAYOUT]) {
        const selector = `.typeset ${tag}`
        const size = typePoints(selector, layout)
        const space = vertical(declaration(selector, 'margin'))
        // h2 だけが下罫の手前に詰めを持ちます。
        const padding = unit(declaration(selector, 'padding-bottom') || '0')
        near(
          height(`${marker}節`, layout),
          emLines(space.top + space.bottom + padding + headingLineHeight, size, layout),
          `${tag} ${layout.columnChars}`,
        )
      }
    }
  })

  it('takes a code block from its padding and its line spacing', () => {
    for (const layout of [PRINT_LAYOUT, MAGAZINE_LAYOUT]) {
      const size = typePoints('.typeset pre', layout)
      const space = vertical(declaration('.typeset pre', 'margin'))
      const padding = vertical(declaration('.typeset pre', 'padding'))
      const spacing = unit(declaration('.typeset pre', 'line-height'))
      // 中の 3 行は折り返さずに数え、上下の詰めと余白を足します。
      near(
        height('```\na\nb\nc\n```', layout),
        emLines(space.top + space.bottom + padding.top + padding.bottom, size, layout) +
          3 * emLines(spacing, size, layout),
        `pre ${layout.columnChars}`,
      )
    }
  })

  it('takes a quotation from its margins, its padding and the paragraphs inside', () => {
    for (const layout of [PRINT_LAYOUT, MAGAZINE_LAYOUT]) {
      const body = layout.bodyPoints
      const space = vertical(declaration('.typeset blockquote', 'margin'))
      const padding = vertical(declaration('.typeset blockquote', 'padding'))
      const frame = emLines(space.top + space.bottom + padding.top + padding.bottom, body, layout)

      // 1 段落の引用は、その 1 行と枠だけ。最後の段落は `p:last-child` で
      // 下の余白を持ちません。
      near(height('> 引用', layout), frame + 1, `blockquote ${layout.columnChars}`)

      // 段落が増えると、その間の余白（p の margin-bottom）が 1 つずつ増えます。
      const paragraph = vertical(declaration('.typeset p', 'margin'))
      near(
        height('> 引用\n>\n> 続き', layout) - height('> 引用', layout),
        1 + emLines(paragraph.bottom, body, layout),
        `blockquote paragraph ${layout.columnChars}`,
      )
    }
  })

  it('takes a list from the items and the space between them', () => {
    for (const layout of [PRINT_LAYOUT, MAGAZINE_LAYOUT]) {
      const body = layout.bodyPoints
      const space = vertical(declaration('.typeset ul', 'margin'))
      const item = vertical(declaration('.typeset li', 'margin'))
      near(
        height('- あ\n- い\n- う', layout),
        3 + emLines(space.top + space.bottom + 3 * item.top, body, layout),
        `list ${layout.columnChars}`,
      )
    }
  })

  it('takes a table from its rows and the padding in the cells', () => {
    for (const layout of [PRINT_LAYOUT, MAGAZINE_LAYOUT]) {
      const size = typePoints('.typeset table', layout)
      const space = vertical(declaration('.typeset table', 'margin'))
      const cell = vertical(declaration('.typeset th', 'padding'))
      // 見出し行と本文 2 行。どのセルも折り返しません。
      near(
        height('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |', layout),
        3 * emLines(layout.lineHeight, size, layout) +
          emLines(space.top + space.bottom + 3 * (cell.top + cell.bottom), size, layout),
        `table ${layout.columnChars}`,
      )
    }
  })

  it('takes a rule from its margins alone', () => {
    // 罫は 0.4pt で、高さはほとんど上下の余白です。1 行と数えていた頃は、
    // 区切りのたびに紙が 1 行ぶん余計に埋まっていました。
    for (const layout of [PRINT_LAYOUT, MAGAZINE_LAYOUT]) {
      const space = vertical(declaration('.typeset hr', 'margin'))
      near(
        height('---', layout),
        emLines(space.top + space.bottom, layout.bodyPoints, layout),
        `hr ${layout.columnChars}`,
      )
    }
  })

  it('overlaps the margins where two blocks meet', () => {
    // 段落の下 0.9em と見出しの上 1.8em は、CSS では重なって 1 つの余白になります。
    // 足し合わせたままだと、見出しのたびに 0.5 行ずつ多く見積もり、紙の下が空きます。
    const blocks = ['<p>本文です。</p>', '<h2>節</h2>', '<p>本文です。</p>']
    const separate = blocks.reduce((total, block) => total + blockLines(block, MAGAZINE_LAYOUT), 0)
    const overlap = 0.9 / MAGAZINE_LAYOUT.lineHeight
    const paper = Math.ceil(separate - overlap)

    // 重ならないと見た高さでは入らない紙に、重なるぶんで収まります。
    assert.ok(separate > paper, `${separate} <= ${paper}`)
    assert.equal(paginate(blocks.join('\n'), sized(paper)).length, 1)
  })
})

// 頁を切っているのは CSS ではなく paginate なので、`break-after: avoid` も
// `widows` / `orphans` も、紙に分けたあとでは働く余地がありません。泣き別れは
// 紙を確定させる前に直します。
describe('widows and orphans', () => {
  /** 見出しのあとに置くブロック。1 行で済む続きと、済まない続き。 */
  const following = [paragraphs(6), fullWidth(400)]

  it('never leaves a heading at the foot of the paper', () => {
    // 見出しは `break-after: avoid`。紙の下端に残ると、次の紙に本文だけが出ます。
    //
    // 直後に 1 行ぶんの空きを取るだけでは足りません。続くのが 1 行では済まない
    // ブロック——長い段落、表、コード——なら、そのブロックだけが次の紙へ回り、
    // 見出しが取り残されます。見出しごと送ります。
    for (const layout of [PRINT_LAYOUT, MAGAZINE_LAYOUT]) {
      for (const after of following) {
        for (let before = 1; before <= 40; before += 1) {
          const source = `${paragraphs(before)}\n\n## 節\n\n${after}`
          for (const page of paginate(renderMarkdown(source), layout)) {
            assert.doesNotMatch(page.trimEnd(), /<\/h[1-3]>$/, `${before} / ${after.slice(0, 8)}`)
          }
        }
      }
    }
  })

  it('never leaves a spanning heading at the foot of the paper', () => {
    // 2段組の h1 は `column-span: all`。段抜きは段組みを区切るだけで、直後の
    // 1 行を連れる約束は見ていませんでした。
    for (const after of following) {
      for (let before = 1; before <= 60; before += 1) {
        const source = `${paragraphs(before)}\n\n# 章\n\n${after}`
        for (const page of paginate(renderMarkdown(source), MAGAZINE_LAYOUT)) {
          assert.doesNotMatch(page.trimEnd(), /<\/h1>$/, `${before} / ${after.slice(0, 8)}`)
        }
      }
    }
  })

  it('does not empty a paper by sending headings on', () => {
    // 見出しが続けばまとめて送ります。送りが連鎖しても紙は空にしません。
    for (const layout of [PRINT_LAYOUT, MAGAZINE_LAYOUT]) {
      for (let before = 1; before <= 40; before += 1) {
        const source = `${paragraphs(before)}\n\n# 章\n\n## 節\n\n### 項\n\n${fullWidth(600)}`
        const pages = paginate(renderMarkdown(source), layout)
        for (const page of pages) {
          assert.notEqual(page.trim(), '', `${before}`)
        }
        // 送っても中身は落ちません。
        const all = pages.join('\n')
        assert.equal((all.match(/<h[1-3]>/g) ?? []).length, 3, `${before}`)
        assert.equal((all.match(/<p>/g) ?? []).length, before + 1, `${before}`)
      }
    }
  })

  it('keeps a heading that ends the manuscript on the last paper', () => {
    // 送り先の紙がありません。送れば見出しだけの紙が 1 枚増えるだけです。
    const pages = paginate(renderMarkdown(`${paragraphs(120)}\n\n## 終わりの節`), PRINT_LAYOUT)
    assert.match(pages.at(-1) ?? '', /<h2>終わりの節<\/h2>$/)
  })

  it('never splits a paragraph across two papers', () => {
    // 段落の最後の 1 行だけが次の紙へ飛ぶことはありません。paginate はブロックの
    // 途中で切らないので、段落は必ずひとつの紙に収まります。紙の中の段の
    // 変わり目は、CSS の `widows` / `orphans` がブラウザに守らせます。
    const source = renderMarkdown(
      Array.from({ length: 30 }, (_, i) => `${fullWidth(200)}${i}`).join('\n\n'),
    )
    for (const layout of [PRINT_LAYOUT, MAGAZINE_LAYOUT]) {
      const pages = paginate(source, layout)
      assert.ok(pages.length > 1)
      for (const page of pages) {
        assert.equal((page.match(/<p>/g) ?? []).length, (page.match(/<\/p>/g) ?? []).length)
      }
    }
    assert.equal(declaration('.typeset p', 'widows'), '2')
    assert.equal(declaration('.typeset p', 'orphans'), '2')
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

function near(actual: number, expected: number, label = ''): void {
  assert.ok(Math.abs(actual - expected) < 0.001, `${label}${actual} !== ${expected}`)
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

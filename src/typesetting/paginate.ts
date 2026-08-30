export const MAGAZINE_LINES_PER_PAGE = 40

/**
 * 1段組。A4 本文（297mm − 上下 46mm）に、短い段落（行送り 1.9em + 下余白 0.9em）
 * がおよそ 24 個入る。2段の 40 より小さいのは、字が大きく段もないため。
 */
export const PRINT_LINES_PER_PAGE = 24

/**
 * 版面の 1 行字詰。全角いくつ分かで数えます。
 *
 * 紙は A4（幅 210mm）で `.paper` の左右余白が 20mm ずつなので、本文の幅は
 * 170mm です。1pt = 0.3528mm として割ると、1段（10.5pt）は 45.9 字、2段の段
 * （段間 8mm を抜いた 81mm を 9.5pt で）は 24.2 字、2段でも段を抜いて組まれる
 * 見出しや図（`column-span: all`）は 50.7 字入ります。
 *
 * 採る値はそれより 1 割ほど少なくします。`text-align: justify` の詰めや約物、
 * 欧文混じりで実際の字詰は上下しますが、少なめに見積もる＝行を多めに数える側に
 * 倒しておけば、高さの決まっている 2段の紙から本文があふれて消えることはありません。
 */
export interface Measure {
  /** 段の 1 行字詰 */
  charsPerLine: number
  /** 段を抜いて組まれる要素（2段の見出し・リード・コード・図）の 1 行字詰 */
  spanCharsPerLine: number
  /** 本文の字の大きさ（pt）。見出しのように pt で決め打たれた字との比に使います */
  bodyPt: number
}

export const PRINT_MEASURE: Measure = {
  charsPerLine: 42,
  spanCharsPerLine: 42,
  bodyPt: 10.5,
}

export const MAGAZINE_MEASURE: Measure = {
  charsPerLine: 22,
  spanCharsPerLine: 46,
  bodyPt: 9.5,
}

/**
 * HTML 断片の組まれる行数で頁に詰める。ブロックの途中では切らない。
 *
 * `measure` を渡すと折り返しを数えます。省略すると、組まれる行を 1 行と数える
 * だけの（折り返しを見ない）数え方に戻ります。
 */
export function paginate(html: string, linesPerPage: number, measure?: Measure): string[] {
  const blocks = splitBlocks(html)
  if (blocks.length === 0) {
    return ['']
  }

  // 頁は文字列のまま組み立てます。いったん string[][] に貯めてから join すると、
  // 頁ごとの配列と、その中身をつないだ文字列を二重に持つことになります。
  const pages: string[] = []
  let current = ''
  let empty = true
  let used = 0
  // `.cols-2 h1 + p` は段を抜くので、直前が h1 かどうかを憶えておきます。
  let afterHeading = false

  for (const block of blocks) {
    const lines = lineCount(block, measure, afterHeading)
    afterHeading = isBlockTag(block, 'h1')
    if (!empty && used + lines > linesPerPage) {
      pages.push(current)
      current = ''
      empty = true
      used = 0
    }
    current = empty ? block : `${current}\n${block}`
    empty = false
    used += lines
  }
  pages.push(current)

  return pages
}

/**
 * ブロックが組まれる行数。
 *
 * もとは HTML の改行を数えるだけでした。renderMarkdown は組まれる行ごとに
 * 改行を入れるので大半は合いますが、2 方向にずれます。
 *
 * - 数え足りない: `<br>`（行末 2 スペースの強制改行）は改行を作りません。
 *   2 段組の紙は高さが 40 行に固定されているので、詩や住所のように強制改行が
 *   続く原稿は、1 行と数えたまま紙からあふれて消えます。
 * - 数えすぎ: `<ul>` や `<table>` の囲みタグは、それ自体では何も組まれないのに
 *   1 つずつ数えていました。5 項目の箇条書きが 7 行、3 行の表が 9 行になり、
 *   頁が早く切れて紙が空きます。
 *
 * そこで「その行に組まれる中身があるか」で数えます。地の文か `<img>`・`<hr>` が
 * あれば 1 行、`<br>` はそこで行を終える、囲みタグだけの行は数えません。
 *
 * さらに `measure` を渡すと、折り返しも数えます。1 行に貯めるのは「本文の全角
 * いくつ分か」で、1 文字の寄与は `字幅 × 字の大きさの比` です。
 *
 * - 字幅は等幅の近似です。ASCII と半角カナが 0.5、ほかは 1.0。フォントメトリクス
 *   は持たないので、ラテン拡張やキリルも全角として数えます（多めに数える側）
 * - 実体参照（`&amp;` など）は、組まれる姿のとおり ASCII 1 文字と数えます
 * - 字の大きさを字詰ではなく幅の側で見るのは、`<p>本文 <code>コード</code></p>`
 *   のように 1 行の途中で字の大きさが変わるからです。字詰を切り替える数え方だと、
 *   その行をどちらの字詰で割るか決められません
 * - 割る字詰から引くのはインデントだけです（`ul` は padding-left 1.5em、
 *   blockquote は margin と padding で約 1.4em）
 *
 * 折り返しは版面の字詰で割った見積もりで、禁則や追い出しは見ません。
 */
// 行を増やしうるもの（改行と `<br>`）。タグ名は下の走査と同じく大小を区別しません。
const BREAKS_LINE = /\n|<br/i

// 字の大きさ。見出しは pt の決め打ち、code と表は本文に対する倍率です（typeset.css）。
const H1_PT = 18
const H2_PT = 13.5
const H3_PT = 12
const CODE_SCALE = 0.92
const TABLE_SCALE = 0.95

// 段からの下がり。`ul`/`ol` の padding-left と、blockquote の margin + padding。
const LIST_INDENT = 1.5
const QUOTE_INDENT = 1.4

function lineCount(html: string, measure: Measure | undefined, afterHeading: boolean): number {
  // 折り返しを見ないときの字詰は無限大です。`ceil(幅 / Infinity)` は 0 なので、
  // どの行も下の `Math.max(1, …)` で 1 行に落ち、もとの数え方に戻ります。
  const base =
    measure === undefined
      ? Number.POSITIVE_INFINITY
      : spansColumns(html, afterHeading)
        ? measure.spanCharsPerLine
        : measure.charsPerLine

  // ブロックの大半は改行も `<br>` も無い 1 行の段落です。長さが字詰に収まって
  // いれば（どの文字も幅 1.0 以下、タグは幅を持たない）折り返しようがないので、
  // 答えは 1 と分かります。文字を 1 つずつ読まずに済ませます。
  //
  // 見出しだけは字が本文より大きく、字数が字詰に収まっていても折り返すので、
  // この早道を通せません。
  const heading =
    measure !== undefined &&
    (isBlockTag(html, 'h1') || isBlockTag(html, 'h2') || isBlockTag(html, 'h3'))
  if (!heading && html.length <= base && !BREAKS_LINE.test(html)) {
    return 1
  }

  let lines = 0
  let visible = false
  let inTag = false
  let width = 0
  let indent = 0
  // 字の大きさ。入れ子（`pre > code`）で二重に掛けないよう深さで持ちます。
  let scale = 1
  let scaleDepth = 0
  // 表のセル。行の高さは、いちばん折り返すセルで決まります。
  let cellMax = 0
  let cells = 0
  let inCell = false

  const flush = (): void => {
    const chars = Math.max(1, base - indent)
    lines += Math.max(1, Math.ceil(width / chars))
    width = 0
    visible = false
  }

  const endCell = (): void => {
    if (!inCell) {
      return
    }
    if (width > cellMax) {
      cellMax = width
    }
    cells += 1
    width = 0
    inCell = false
  }

  for (let i = 0; i < html.length; i += 1) {
    const code = html.charCodeAt(i)

    if (inTag) {
      if (code === 0x3e) {
        inTag = false
      }
      continue
    }

    if (code === 0x3c) {
      inTag = true
      let start = i + 1
      const closing = html.charCodeAt(start) === 0x2f
      if (closing) {
        start += 1
      }
      const end = tagNameEnd(html, start)

      if (isName(html, start, end, 'br')) {
        flush()
      } else if (isName(html, start, end, 'hr') || isName(html, start, end, 'img')) {
        visible = true
      } else if (isName(html, start, end, 'ul') || isName(html, start, end, 'ol')) {
        indent += closing ? -LIST_INDENT : LIST_INDENT
      } else if (isName(html, start, end, 'blockquote')) {
        indent += closing ? -QUOTE_INDENT : QUOTE_INDENT
      } else if (isName(html, start, end, 'tr')) {
        if (closing) {
          endCell()
          const chars = Math.max(1, (base - indent) / Math.max(1, cells))
          lines += Math.max(1, Math.ceil(cellMax / chars))
          visible = false
        } else {
          cellMax = 0
          cells = 0
          width = 0
        }
      } else if (isName(html, start, end, 'td') || isName(html, start, end, 'th')) {
        if (closing) {
          endCell()
        } else {
          width = 0
          inCell = true
        }
      } else {
        const font = fontScale(html, start, end, measure)
        if (font !== 0) {
          if (closing) {
            scaleDepth -= 1
            if (scaleDepth === 0) {
              scale = 1
            }
          } else {
            if (scaleDepth === 0) {
              scale = font
            }
            scaleDepth += 1
          }
        }
      }
      continue
    }

    if (code === 0x0a) {
      if (visible) {
        flush()
      }
      width = 0
      continue
    }

    if (code === 0x20 || code === 0x09 || code === 0x0d) {
      // 行頭の空白は、タグとタグのあいだの字下げなので数えません。
      if (visible) {
        width += 0.5 * scale
      }
      continue
    }

    visible = true

    if (code === 0x26) {
      const entity = entityEnd(html, i)
      if (entity !== -1) {
        // 実体参照は 5 種とも ASCII 1 文字に組まれます。
        width += 0.5 * scale
        i = entity
        continue
      }
    }

    if (code >= 0xd800 && code <= 0xdbff) {
      // 追加面の文字（絵文字や CJK 拡張）。2 コードユニットで 1 文字です。
      width += scale
      i += 1
      continue
    }

    width += charWidth(code) * scale
  }

  if (visible) {
    flush()
  }
  // 何も組まれないブロックでも、詰め込みが進むよう 1 行は取ります。
  return lines === 0 ? 1 : lines
}

/** 1 文字の幅。全角を 1.0 とした近似です。 */
function charWidth(code: number): number {
  if (code < 0x80) {
    return 0.5
  }
  // 半角カナ。
  if (code >= 0xff61 && code <= 0xff9f) {
    return 0.5
  }
  return 1
}

/** html の [start, end) のタグの字の大きさ。字を変えないタグは 0 を返します。 */
function fontScale(html: string, start: number, end: number, measure: Measure | undefined): number {
  const bodyPt = measure === undefined ? PRINT_MEASURE.bodyPt : measure.bodyPt
  if (isName(html, start, end, 'h1')) {
    return H1_PT / bodyPt
  }
  if (isName(html, start, end, 'h2')) {
    return H2_PT / bodyPt
  }
  if (isName(html, start, end, 'h3')) {
    return H3_PT / bodyPt
  }
  if (isName(html, start, end, 'pre') || isName(html, start, end, 'code')) {
    return CODE_SCALE
  }
  if (isName(html, start, end, 'table')) {
    return TABLE_SCALE
  }
  return 0
}

/**
 * 2段でも段を抜いて紙の幅いっぱいに組まれるブロックかどうか。
 *
 * typeset.css の `.typeset.cols-2 … { column-span: all }` と同じ並びです
 * （`h1`、その直後の段落、`pre`、`hr`、画像だけの段落）。
 */
function spansColumns(html: string, afterHeading: boolean): boolean {
  if (
    isBlockTag(html, 'h1') ||
    isBlockTag(html, 'pre') ||
    isBlockTag(html, 'hr') ||
    isBlockTag(html, 'img')
  ) {
    return true
  }
  if (!isBlockTag(html, 'p')) {
    return false
  }
  if (afterHeading) {
    return true
  }
  // `p:has(> img:only-child)`。画像 1 つだけの段落は図として段を抜きます。
  if (!isTag(html, 4, 'img')) {
    return false
  }
  const gt = html.indexOf('>', 3)
  return gt !== -1 && html.length === gt + 5 && html.endsWith('</p>')
}

/** ブロックの先頭が `<name` で始まるかどうか。 */
function isBlockTag(html: string, name: string): boolean {
  return html.charCodeAt(0) === 0x3c && isTag(html, 1, name)
}

/**
 * `&` から始まる実体参照の `;` の位置。実体参照でなければ -1。
 *
 * renderMarkdown が出すのは 5 種だけですが、名前と番号のどちらの形も
 * 1 文字として数えます。
 */
function entityEnd(html: string, start: number): number {
  const limit = Math.min(html.length, start + 10)
  for (let i = start + 1; i < limit; i += 1) {
    const code = html.charCodeAt(i)
    if (code === 0x3b) {
      return i === start + 1 ? -1 : i
    }
    const lower = code | 0x20
    if ((lower < 0x61 || lower > 0x7a) && (code < 0x30 || code > 0x39) && code !== 0x23) {
      return -1
    }
  }
  return -1
}

// `<` の次から始まるタグ名が name かどうか。slice を作らずに比べます。
function isTag(html: string, start: number, name: string): boolean {
  for (let i = 0; i < name.length; i += 1) {
    if ((html.charCodeAt(start + i) | 0x20) !== name.charCodeAt(i)) {
      return false
    }
  }
  const after = html.charCodeAt(start + name.length)
  return after === 0x3e || after === 0x20 || after === 0x2f
}

function splitBlocks(html: string): string[] {
  const blocks: string[] = []
  let i = 0

  while (i < html.length) {
    const code = html.charCodeAt(i)
    if (code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20) {
      i += 1
      continue
    }
    if (code !== 0x3c) {
      const next = html.indexOf('<', i)
      const end = next === -1 ? html.length : next
      const text = html.slice(i, end).trim()
      if (text.length > 0) {
        blocks.push(text)
      }
      i = end
      continue
    }
    const end = elementEnd(html, i)
    blocks.push(html.slice(i, end))
    i = end
  }

  return blocks
}

function elementEnd(html: string, start: number): number {
  const gt = html.indexOf('>', start)
  if (gt === -1) {
    return html.length
  }
  // タグ名は html の中の範囲として持ちます。切り出して toLowerCase すると、
  // ブロックごとに短い文字列を 2 つ捨てることになり、GC がそのぶん回ります。
  let nameStart = start + 1
  if (html.charCodeAt(nameStart) === 0x2f) {
    nameStart += 1
  }
  const nameEnd = tagNameEnd(html, nameStart)
  if (
    nameEnd === nameStart ||
    isName(html, nameStart, nameEnd, 'hr') ||
    isName(html, nameStart, nameEnd, 'br') ||
    isName(html, nameStart, nameEnd, 'img') ||
    html.charCodeAt(gt - 1) === 0x2f
  ) {
    return gt + 1
  }
  const nameLength = nameEnd - nameStart

  // 同じ名前の開きタグと閉じタグを、`<` を 1 つずつ辿って数えます。
  //
  // もとは `indexOf('<name')` と `indexOf('</name>')` を交互に呼んでいました。
  // 閉じタグがすぐ先にあっても、開きタグの探索は次の同名タグまで（無ければ
  // 原稿の末尾まで）走ります。原稿にひとつしかない見出しなどでは、その 1 ブロック
  // ごとに全体を走ることになり、ブロック数に対して二乗時間でした。CPU profile
  // では、この関数だけで組版全体の 1/4 を使っていました。
  //
  // 走査を要素の内側に閉じ込めると、全体の走査量は HTML の長さに比例します。
  let depth = 1
  let i = gt + 1
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      return html.length
    }

    if (html.charCodeAt(lt + 1) === 0x2f) {
      // `</name>` だけを閉じとみなします（`</names>` は別の要素）。
      if (
        sameTag(html, lt + 2, nameStart, nameLength) &&
        html.charCodeAt(lt + 2 + nameLength) === 0x3e
      ) {
        depth -= 1
        if (depth === 0) {
          return lt + 2 + nameLength + 1
        }
      }
    } else if (sameTag(html, lt + 1, nameStart, nameLength)) {
      depth += 1
    }
    i = lt + 1
  }
  return html.length
}

// from から始まるタグ名の終端。タグ名でなければ from をそのまま返します。
function tagNameEnd(html: string, from: number): number {
  const first = html.charCodeAt(from) | 0x20
  if (first < 0x61 || first > 0x7a) {
    return from
  }

  let i = from + 1
  while (i < html.length) {
    const c = html.charCodeAt(i)
    const lower = c | 0x20
    if ((lower < 0x61 || lower > 0x7a) && (c < 0x30 || c > 0x39)) {
      break
    }
    i += 1
  }
  return i
}

// html の [start, end) が name かどうか。大小は区別しません。
function isName(html: string, start: number, end: number, name: string): boolean {
  if (end - start !== name.length) {
    return false
  }
  for (let i = 0; i < name.length; i += 1) {
    if ((html.charCodeAt(start + i) | 0x20) !== name.charCodeAt(i)) {
      return false
    }
  }
  return true
}

// at から始まるタグ名が、nameStart から nameLength 文字の名前と同じかどうか。
function sameTag(html: string, at: number, nameStart: number, nameLength: number): boolean {
  for (let i = 0; i < nameLength; i += 1) {
    if ((html.charCodeAt(at + i) | 0x20) !== (html.charCodeAt(nameStart + i) | 0x20)) {
      return false
    }
  }
  const after = html.charCodeAt(at + nameLength)
  return after === 0x3e || after === 0x20 || after === 0x2f
}

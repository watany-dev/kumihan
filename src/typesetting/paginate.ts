export const MAGAZINE_LINES_PER_PAGE = 40

/**
 * 1段組。A4 本文（297mm − 上下 46mm）に、短い段落（行送り 1.9em + 下余白 0.9em）
 * がおよそ 24 個入る。2段の 40 より小さいのは、字が大きく段もないため。
 */
export const PRINT_LINES_PER_PAGE = 24

// 同じ断片は組版（24 行）と 2段（40 行）の両方が頁分けします。書き出しは
// 必ず両方を作り、プレビューもモードを切り替えるたびに同じ断片で来ます。
// ブロック分割と行数えは断片全体の走査なので、直前の結果をひとつだけ覚えて
// 2 回目からは頁への詰め込み（ブロック数に比例）だけで済ませます。
// 比較は同一の文字列オブジェクトなら一瞬で、たまたま別オブジェクトでも
// 走査 1 回ぶんより高くつきません。
let cachedHtml: string | null = null
let cachedBlocks: string[] = []
let cachedCounts: number[] = []

function blocksOf(html: string): { blocks: string[]; counts: number[] } {
  if (html === cachedHtml) {
    return { blocks: cachedBlocks, counts: cachedCounts }
  }
  const blocks = splitBlocks(html)
  const counts: number[] = []
  for (const block of blocks) {
    counts.push(lineCount(block))
  }
  cachedHtml = html
  cachedBlocks = blocks
  cachedCounts = counts
  return { blocks, counts }
}

/**
 * HTML 断片の改行数で頁に詰める。ブロックの途中では切らない。
 *
 * ponytail: 折り返しや段の高さは見ない。視覚行がずれたら estimate を足す。
 */
export function paginate(html: string, linesPerPage: number): string[] {
  const { blocks, counts } = blocksOf(html)
  if (blocks.length === 0) {
    return ['']
  }

  // 頁は文字列のまま組み立てます。いったん string[][] に貯めてから join すると、
  // 頁ごとの配列と、その中身をつないだ文字列を二重に持つことになります。
  const pages: string[] = []
  let current = ''
  let empty = true
  let used = 0

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index] ?? ''
    const lines = counts[index] ?? 1
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
 *   1 行ずつ数えていました。5 項目の箇条書きが 7 行、3 行の表が 9 行になり、
 *   頁が早く切れて紙が空きます。
 *
 * そこで「その行に組まれる中身があるか」で数えます。地の文か `<img>`・`<hr>` が
 * あれば 1 行、`<br>` はそこで行を終える、囲みタグだけの行は数えません。
 * 折り返しは相変わらず見ません（見るには字幅が要ります）。
 */
// 行を増やしうるもの（改行と `<br>`）。タグ名は下の走査と同じく大小を区別しません。
const BREAKS_LINE = /\n|<br/i

function lineCount(html: string): number {
  // ブロックの大半は改行も `<br>` も無い 1 行の段落や見出しです。そのときは
  // 下の走査がどう転んでも答えは 1 なので（中身があれば 1、無くても最後に 1 に
  // 切り上げる）、文字を 1 つずつ読まずに済ませます。indexOf は 1 文字ずつの
  // ループより桁で速く、ここは HTML 全体を舐める場所でした。
  if (!BREAKS_LINE.test(html)) {
    return 1
  }

  let lines = 0
  let visible = false
  let inTag = false

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
      if (isTag(html, i + 1, 'br')) {
        lines += 1
        visible = false
      } else if (isTag(html, i + 1, 'hr') || isTag(html, i + 1, 'img')) {
        visible = true
      }
      continue
    }
    if (code === 0x0a) {
      if (visible) {
        lines += 1
      }
      visible = false
      continue
    }
    if (code !== 0x20 && code !== 0x09 && code !== 0x0d) {
      visible = true
    }
  }

  if (visible) {
    lines += 1
  }
  // 何も組まれないブロックでも、詰め込みが進むよう 1 行は取ります。
  return lines === 0 ? 1 : lines
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

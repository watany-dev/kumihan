import { escapeHtml } from './escape.js'
import { HARD_BREAK, stripHardBreakSentinel } from './hard-break.js'
import { renderInline } from './inline.js'
import { isTableStart, parseTable } from './table.js'

function lineAt(lines: readonly string[], index: number): string {
  const line = lines[index]
  if (typeof line === 'string') {
    return line
  }
  /* v8 ignore next -- String#split produces a dense array */
  return ''
}

// 引用は入れ子にできるため renderLines は自分を再帰呼び出しします。
// `>` を並べただけの原稿でスタックを溢れさせないよう、深さを制限します。
// これを超えた引用の中身は、記法を解釈せず段落として出します。
const MAX_BLOCKQUOTE_DEPTH = 32

const BACKTICK = 0x60
const HASH = 0x23
const GREATER_THAN = 0x3e
const HYPHEN = 0x2d
const SPACE = 0x20
const DOT = 0x2e
const ZERO = 0x30
const NINE = 0x39

/**
 * 箇条書きの行なら中身が始まる位置、そうでなければ -1 を返します。
 *
 * もとは `/^- /` と `/^\d+\. /` を test と replace で 2 回ずつ当てていました。
 * 記法がごく単純なので、文字コードを直接読んだほうが速く、正規表現の
 * マッチ結果を確保せずに済みます。
 */
function unorderedOffset(line: string): number {
  return line.charCodeAt(0) === HYPHEN && line.charCodeAt(1) === SPACE ? 2 : -1
}

// `/^\d+\. /` と同じ判定です。数字が 1 文字以上続き、`.` と空白が続くこと。
function orderedOffset(line: string): number {
  let i = 0
  while (i < line.length) {
    const code = line.charCodeAt(i)
    if (code < ZERO || code > NINE) break
    i += 1
  }

  if (i === 0 || line.charCodeAt(i) !== DOT || line.charCodeAt(i + 1) !== SPACE) {
    return -1
  }
  return i + 2
}

// 改行コードの正規化は原稿全体を作り直します。`\r` を含まない原稿（ほとんどが
// そうです）では indexOf 一回で済ませ、正規表現と再確保をまるごと省きます。
function normalizeNewlines(source: string): string {
  return source.indexOf('\r') === -1 ? source : source.replace(/\r\n?/g, '\n')
}

export function renderMarkdown(source: string): string {
  return renderIncremental(source)
}

// ===== 増分変換 =====
//
// プレビューは保存のたびに原稿全体を渡し直しますが、変わるのはふつう
// 1 ブロックだけです。原稿を「空行で区切られた区画」に分け、前回の原稿と
// 字面が同じ区画は変換せず、前回の変換結果をそのまま使い回します。これで
// 保存から表示までの変換は、原稿の長さではなく変わった量に比例します。
//
// 区画の区切りにできるのは、フェンスコードの外にある空行（`\n\n`）だけです。
// フェンスは空行をまたげる唯一のブロックなので（見出し・水平線は 1 行で、
// 引用・箇条書き・表・段落はどれも空行で終わる）、フェンスの中の空行だけ
// 区切りにしなければ、区画ごとの変換結果をつないだものは原稿全体を一度に
// 変換した結果と一致します。空白を含む「見た目だけ空の行」は区切りに
// しませんが、renderLines がどのみち読み飛ばすので結果は変わりません。
//
// どの区画が変わったかは、前回の原稿との共通の先頭・末尾の長さで判定します。
// 位置がずれても使い回せるよう、末尾側は「前回の区画の頭と字面が揃った所」
// から先を丸ごと写します。区画の切り方も変換結果も、その位置から後ろの
// 字面だけで決まる（前に何があったかは影響しない）ので、これは原稿全体を
// 変換し直した結果と一致します。

const NEWLINE = 0x0a

interface RenderedManuscript {
  /** 正規化（改行と目印の除去）後の原稿。 */
  text: string
  /** 渡された原稿が正規化不要（text と同じもの）だったか。 */
  clean: boolean
  /** 原稿全体の変換結果。 */
  html: string
  /** 各区画の開始位置（text 内、昇順）。 */
  starts: Int32Array
  /** 各区画の終端。区切りの空行の 1 つ目の `\n` の位置か、text.length。 */
  ends: Int32Array
  /** その区画までを変換し終えた時点の html の長さ。空白だけの区画は前と同じ値。 */
  htmlEnds: Int32Array
}

let lastRender: RenderedManuscript | null = null

/** 直前の変換結果を忘れる。計測とテストが変換の素の速さを見るために使う。 */
export function resetRenderCache(): void {
  lastRender = null
}

function renderIncremental(raw: string): string {
  const previous = lastRender
  let text = raw
  let prefix = -1
  let suffix = 0

  if (previous !== null && previous.clean) {
    // 前回の原稿は正規化不要だった。まず生の原稿どうしで差分を取り、変わった
    // 範囲だけ正規化が要るかを確かめます。共通部分は前回と同じ字面（＝正規化
    // 不要と確認済み）なので、原稿全体を `\r` と目印の 2 回走査せずに済みます。
    prefix = commonPrefixLength(previous.text, raw)
    if (prefix === raw.length && raw.length === previous.text.length) {
      return previous.html
    }
    suffix = commonSuffixLength(previous.text, raw, prefix)
    const middle = raw.slice(prefix, raw.length - suffix)
    if (middle.indexOf('\r') !== -1 || middle.indexOf(HARD_BREAK) !== -1) {
      // 変わった範囲に正規化の対象がある。位置がずれるので測り直します。
      text = stripHardBreakSentinel(normalizeNewlines(raw))
      prefix = -1
    }
  } else {
    text = stripHardBreakSentinel(normalizeNewlines(raw))
  }

  if (previous !== null && prefix === -1) {
    prefix = commonPrefixLength(previous.text, text)
    if (prefix === text.length && text.length === previous.text.length) {
      return previous.html
    }
    suffix = commonSuffixLength(previous.text, text, prefix)
  }

  // 前回と共通の先頭部分に、区切りの空行ごと収まっている区画は使い回します。
  let head = 0
  let from = 0
  let suffixStart = text.length + 1
  let delta = 0
  if (previous !== null) {
    head = reusableHeadCount(previous.ends, prefix)
    if (head > 0) {
      from = numberAt(previous.ends, head - 1) + 1
    }
    suffixStart = text.length - suffix
    delta = text.length - previous.text.length
  }

  // 変わった範囲だけを変換し直します。
  const midStarts: number[] = []
  const midEnds: number[] = []
  const midPieces: string[] = []
  let tail = -1
  let i = from
  while (i < text.length) {
    while (text.charCodeAt(i) === NEWLINE) {
      i += 1
    }
    if (i >= text.length) break

    // ここから先が前回と同じ字面で、前回の区画の頭とも揃っているなら、
    // 残りの区画は位置をずらすだけで使い回せます。
    if (previous !== null && i >= suffixStart) {
      const found = indexOfStart(previous.starts, i - delta, head)
      if (found !== -1) {
        tail = found
        break
      }
    }

    const end = segmentEnd(text, i)
    midStarts.push(i)
    midEnds.push(end)
    midPieces.push(renderLines(text.slice(i, end).split('\n'), 0))
    i = end + 1
  }

  const rendered = assemble(previous, head, midStarts, midEnds, midPieces, tail, delta)
  lastRender = {
    text,
    // 正規化が何もしなかったときは同じ文字列がそのまま返ってくるので、
    // これは参照の比較で済みます。
    clean: text === raw,
    html: rendered.html,
    starts: rendered.starts,
    ends: rendered.ends,
    htmlEnds: rendered.htmlEnds,
  }
  return rendered.html
}

interface AssembledRender {
  html: string
  starts: Int32Array
  ends: Int32Array
  htmlEnds: Int32Array
}

/**
 * 使い回す先頭（前回の区画 0..head-1）、変換し直した中間、使い回す末尾
 * （前回の区画 tail..末尾、位置は delta ずらす）をつなぎます。
 *
 * 使い回しは区画単位の変換をやり直さないだけでなく、html も前回の文字列の
 * 切り貼りで作ります。区画ごとの断片を貯め直してつなぐと、原稿全体の区画数
 * ぶんの作業が毎回発生し、大きな原稿では使い回しの意味がなくなるためです。
 * 区画の位置は Int32Array に持ち、書き写しをネイティブのコピーにします。
 */
function assemble(
  previous: RenderedManuscript | null,
  head: number,
  midStarts: readonly number[],
  midEnds: readonly number[],
  midPieces: readonly string[],
  tail: number,
  delta: number,
): AssembledRender {
  const tailCount = previous !== null && tail !== -1 ? previous.starts.length - tail : 0
  const count = head + midStarts.length + tailCount
  const starts = new Int32Array(count)
  const ends = new Int32Array(count)
  const htmlEnds = new Int32Array(count)

  let html = ''
  if (previous !== null && head > 0) {
    starts.set(previous.starts.subarray(0, head))
    ends.set(previous.ends.subarray(0, head))
    htmlEnds.set(previous.htmlEnds.subarray(0, head))
    // htmlEnds は空白だけの区画に区切りを含めないので、この切り出しが
    // 区切りの `\n` で終わることはありません。
    html = previous.html.slice(0, numberAt(previous.htmlEnds, head - 1))
  }

  for (let k = 0; k < midStarts.length; k += 1) {
    const piece = lineAt(midPieces, k)
    const at = head + k
    starts[at] = numberAt(midStarts, k)
    ends[at] = numberAt(midEnds, k)
    // 空白だけの区画（変換結果が空）は、全体を一度に変換したときと同じく
    // 何も出しません。
    if (piece.length > 0) {
      html = html.length === 0 ? piece : `${html}\n${piece}`
    }
    htmlEnds[at] = html.length
  }

  if (previous !== null && tailCount > 0) {
    spliceTail(previous, tail, delta, html.length, starts, ends, htmlEnds, count - tailCount)
    html = joinTailHtml(html, previous, tail)
  }

  return { html, starts, ends, htmlEnds }
}

// 使い回す末尾の html。前回の html から末尾の区画のぶんを切り出してつなぎます。
function joinTailHtml(html: string, previous: RenderedManuscript, tail: number): string {
  const from = tail === 0 ? 0 : numberAt(previous.htmlEnds, tail - 1)
  const tailHtml = previous.html.slice(from)
  if (tailHtml.length === 0) {
    // 使い回す区画がすべて空白だけだった。
    return html
  }
  // 先頭が `\n` なら、それは前回そこにあった区切りです。ブロックの変換結果は
  // 必ずタグか本文で始まるので、区画の中身と取り違えることはありません。
  if (tailHtml.charCodeAt(0) === NEWLINE) {
    return html.length === 0 ? tailHtml.slice(1) : html + tailHtml
  }
  // 区切りが無いのは、前回ここより前に何も出ていなかったとき。
  return html.length === 0 ? tailHtml : `${html}\n${tailHtml}`
}

// 使い回す末尾の区画の位置を、ずらしながら書き写します。
function spliceTail(
  previous: RenderedManuscript,
  tail: number,
  delta: number,
  base: number,
  starts: Int32Array,
  ends: Int32Array,
  htmlEnds: Int32Array,
  at: number,
): void {
  const from = tail === 0 ? 0 : numberAt(previous.htmlEnds, tail - 1)
  const separated = previous.html.charCodeAt(from) === NEWLINE
  // html の中で、使い回す部分が前回いた位置と今回置かれる位置の差。
  // 区切りの `\n` は「次に出る中身」の側に付くので、中身が出る前の区画
  // （htmlEnds が from のままのもの）は base に写します。
  const shift = separated ? (base > 0 ? base : -1) - from : base > 0 ? base + 1 : 0

  const count = previous.starts.length - tail
  for (let k = 0; k < count; k += 1) {
    const target = at + k
    starts[target] = numberAt(previous.starts, tail + k) + delta
    ends[target] = numberAt(previous.ends, tail + k) + delta
    const end = numberAt(previous.htmlEnds, tail + k)
    htmlEnds[target] = end === from ? base : end + shift
  }
}

/**
 * start（行頭）から始まる区画の終端を返します。フェンスコードの外にある
 * 最初の空行（`\n\n`）の 1 つ目の `\n` の位置、無ければ text.length。
 *
 * renderLines と同じく「``` で始まる行」がフェンスの開閉を切り替えます。
 * 空行の候補ごとに、そこまでの ``` 行の数の偶奇を数え、奇数（フェンスの中）
 * なら区切りにせず先へ延ばします。走査は区画の中に閉じているので、全体の
 * 走査量は原稿の長さに比例したままです。
 */
function segmentEnd(text: string, start: number): number {
  let insideFence = isFenceLineAt(text, start)
  let scanned = start
  let cursor = start
  while (true) {
    const boundary = text.indexOf('\n\n', cursor)
    if (boundary === -1) {
      return text.length
    }
    // [scanned, boundary) にある「``` で始まる行」を数えます。2 行目以降の
    // 行頭は `\n` の次なので、`\n` 込みで探せば行頭だけに一致します
    // （1 行目は上の isFenceLineAt が見ています）。
    const window = text.slice(scanned, boundary)
    let at = window.indexOf('\n```')
    while (at !== -1) {
      insideFence = !insideFence
      // 次の一致の `\n` は、いま見つけた行の ``` 3 文字より後ろにしかない。
      at = window.indexOf('\n```', at + 4)
    }
    scanned = boundary
    if (!insideFence) {
      return boundary
    }
    cursor = boundary + 1
  }
}

function isFenceLineAt(text: string, at: number): boolean {
  return (
    text.charCodeAt(at) === BACKTICK &&
    text.charCodeAt(at + 1) === BACKTICK &&
    text.charCodeAt(at + 2) === BACKTICK
  )
}

/**
 * 前回の区画のうち、区切りの空行（`\n\n` の 2 文字）が丸ごと共通の先頭部分に
 * 収まっているものの数。その空行までは前回とまったく同じ字面なので、区画の
 * 切り方も変換結果も変わりません。ends は昇順なので二分探索で数えられます。
 */
function reusableHeadCount(ends: ArrayLike<number>, prefix: number): number {
  let low = 0
  let high = ends.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (numberAt(ends, mid) <= prefix - 2) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

// starts の [from, 末尾] から target と一致する位置を二分探索します。無ければ -1。
function indexOfStart(starts: ArrayLike<number>, target: number, from: number): number {
  let low = from
  let high = starts.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const value = numberAt(starts, mid)
    if (value === target) return mid
    if (value < target) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return -1
}

// 差分の走査はこの幅ごとに部分文字列の比較（エンジン内の memcmp）で進め、
// 食い違った所だけ 1 文字ずつ調べます。1 文字ずつのループを原稿全体に
// かけるより桁で速く、比較の総量は一致している長さ + この幅で抑えられます。
const DIFF_CHUNK = 65536

/** 2 つの文字列が先頭から一致している長さ。 */
function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let low = 0
  while (low < max) {
    const end = Math.min(low + DIFF_CHUNK, max)
    if (b.startsWith(a.slice(low, end), low)) {
      low = end
      continue
    }
    while (low < end && a.charCodeAt(low) === b.charCodeAt(low)) {
      low += 1
    }
    break
  }
  return low
}

// 末尾から一致している長さ。先頭の一致（prefix）と重ならない範囲で探します。
function commonSuffixLength(a: string, b: string, prefix: number): number {
  const max = Math.min(a.length, b.length) - prefix
  let low = 0
  while (low < max) {
    const size = Math.min(DIFF_CHUNK, max - low)
    if (b.endsWith(a.slice(a.length - low - size, a.length - low), b.length - low)) {
      low += size
      continue
    }
    while (low < max && a.charCodeAt(a.length - 1 - low) === b.charCodeAt(b.length - 1 - low)) {
      low += 1
    }
    break
  }
  return low
}

function numberAt(values: ArrayLike<number>, index: number): number {
  const value = values[index]
  if (typeof value === 'number') {
    return value
  }
  /* v8 ignore next -- 添字は必ず範囲内 */
  return 0
}

// 入れ子の引用は行の配列をそのまま渡します。以前は引用の中身を `\n` で
// つないでから renderMarkdown に渡していましたが、渡された側はまず同じ
// 区切りで split し直すだけでした。改行の正規化と目印の除去も外側で済んで
// いるので、この往復はまるごと省けます。
function renderLines(lines: readonly string[], depth: number): string {
  let blocks = ''
  let i = 0

  while (i < lines.length) {
    const line = lineAt(lines, i)

    if (isBlank(line)) {
      i += 1
      continue
    }

    // ブロックの種類は先頭 1 文字でほぼ絞れます。先に読んでおくと、当てはまら
    // ない行に対して startsWith や正規表現をいくつも試さずに済みます。
    // 判定の順番は以前のままです（先頭文字が一致しても記法として成立しない
    // 行、たとえば `####x` は、そのまま次の判定へ進みます）。
    const first = line.charCodeAt(0)

    if (first === BACKTICK && line.startsWith('```')) {
      const parsed = parseFencedCode(lines, i)
      blocks = append(blocks, parsed.html)
      i = parsed.next
      continue
    }

    if (first === HASH) {
      const heading = parseHeading(line)
      if (heading) {
        blocks = append(blocks, heading)
        i += 1
        continue
      }
    }

    if (isHorizontalRule(line)) {
      blocks = append(blocks, '<hr>')
      i += 1
      continue
    }

    if (first === GREATER_THAN && depth < MAX_BLOCKQUOTE_DEPTH) {
      const parsed = parseBlockquote(lines, i, depth)
      blocks = append(blocks, parsed.html)
      i = parsed.next
      continue
    }

    if (unorderedOffset(line) > 0) {
      const parsed = parseList(lines, i, 'ul', unorderedOffset)
      blocks = append(blocks, parsed.html)
      i = parsed.next
      continue
    }

    if (orderedOffset(line) > 0) {
      const parsed = parseList(lines, i, 'ol', orderedOffset)
      blocks = append(blocks, parsed.html)
      i = parsed.next
      continue
    }

    // 表は先頭文字では決まりません（`Name | Value` のように `|` が途中でも
    // 始まる）。区切り行まで見てから、段落へ落とします。
    const table = parseTable(lines, i, (row) => isBlank(row) || isNonTableBlockStart(row, depth))
    if (table) {
      blocks = append(blocks, table.html)
      i = table.next
      continue
    }

    const parsed = parseParagraph(lines, i, depth)
    blocks = append(blocks, parsed.html)
    i = parsed.next
  }

  return blocks
}

// ブロックの連結は文字列で行います。配列に貯めて join すると、配列そのものと
// 連結後の文字列を二重に持つことになります。
function append(blocks: string, html: string): string {
  return blocks.length === 0 ? html : `${blocks}\n${html}`
}

/**
 * `/^(#{1,3}) (.+)$/` と同じ判定で、見出しの段（`#` の数）を返します。
 * 見出しでなければ 0。本文が始まる位置は必ず `level + 1` です。
 *
 * `#` は 1〜3 個、そのあとに空白 1 つ、そして中身が 1 文字以上。正規表現だと
 * 一致のたびに配列と 2 つの部分文字列を確保しますが、この形なら文字コードを
 * 4 回読むだけで済みます。見出しが多い原稿では、ここが変換全体の数 % でした。
 */
function headingLevel(line: string): number {
  let level = 0
  while (level < 4 && line.charCodeAt(level) === HASH) {
    level += 1
  }
  if (level === 0 || level > 3) return 0
  if (line.charCodeAt(level) !== SPACE) return 0
  return line.length > level + 1 ? level : 0
}

// 見出しになりうるのは `#` で始まる行だけです。この 1 文字を先に見ておくと、
// 段落の各行に見出しの判定を通さずに済みます。
function isHeadingLine(line: string): boolean {
  return line.charCodeAt(0) === HASH && headingLevel(line) > 0
}

// 呼び出し元は行が `#` で始まることを確かめています。
function parseHeading(line: string): string | null {
  const level = headingLevel(line)
  if (level === 0) {
    return null
  }
  return `<h${level}>${renderInline(line.slice(level + 1).trim())}</h${level}>`
}

const BLANK = /^\s*$/
const HORIZONTAL_RULE = /^\s*-{3,}\s*$/

function isBlank(line: string): boolean {
  return line.length === 0 || BLANK.test(line)
}

function isHorizontalRule(line: string): boolean {
  return HORIZONTAL_RULE.test(line)
}

function parseFencedCode(lines: readonly string[], start: number): { html: string; next: number } {
  const body: string[] = []
  let i = start + 1

  while (i < lines.length) {
    const line = lineAt(lines, i)
    if (line.startsWith('```')) {
      break
    }
    body.push(line)
    i += 1
  }

  if (i < lines.length) {
    i += 1
  }

  return {
    html: `<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`,
    next: i,
  }
}

function parseBlockquote(
  lines: readonly string[],
  start: number,
  depth: number,
): { html: string; next: number } {
  const inner: string[] = []
  let i = start

  while (i < lines.length) {
    const line = lineAt(lines, i)
    if (!line.startsWith('>')) {
      break
    }
    let content = line.slice(1)
    if (content.startsWith(' ')) {
      content = content.slice(1)
    }
    inner.push(content)
    i += 1
  }

  const innerHtml = renderLines(inner, depth + 1)
  return {
    html: `<blockquote>\n${innerHtml}\n</blockquote>`,
    next: i,
  }
}

function parseList(
  lines: readonly string[],
  start: number,
  tag: 'ul' | 'ol',
  offsetOf: (line: string) => number,
): { html: string; next: number } {
  let items = ''
  let i = start

  while (i < lines.length) {
    const line = lineAt(lines, i)
    const offset = offsetOf(line)
    if (offset < 0) {
      break
    }
    const item = `<li>${renderInline(line.slice(offset))}</li>`
    items = i === start ? item : `${items}\n${item}`
    i += 1
  }

  return {
    html: `<${tag}>\n${items}\n</${tag}>`,
    next: i,
  }
}

function parseParagraph(
  lines: readonly string[],
  start: number,
  depth: number,
): { html: string; next: number } {
  const collected: string[] = []
  let i = start

  while (i < lines.length) {
    const line = lineAt(lines, i)
    if (isBlank(line) || isBlockStart(line, depth, lineAt(lines, i + 1))) {
      break
    }
    collected.push(line)
    i += 1
  }

  /* v8 ignore start -- isBlockStart は renderMarkdown の分岐と一致しているため到達しない */
  if (i === start) {
    // 保険。どのブロックにもならなかった行をここで消費しないと、
    // 呼び出し側の while ループが前進せず無限ループになる。
    collected.push(lineAt(lines, start))
    i = start + 1
  }
  /* v8 ignore stop */

  const joined = joinParagraphLines(collected)
  // 目印を <br> にするのは renderInline の地の文だけです。ここでまとめて
  // 置き換えると、コードスパンの中身にまで <br> が入り込みます。
  const html = renderInline(joined)
  return {
    html: `<p>${html}</p>`,
    next: i,
  }
}

// ブロックを開始しうる先頭文字（水平線は字下げを許すため空白も含む）。
// 段落の大半はこの 1 回の判定だけで抜けられます。
const BLOCK_START_HEAD = /^[`#\->\d\s]/

function isNonTableBlockStart(line: string, depth: number): boolean {
  if (!BLOCK_START_HEAD.test(line)) return false
  if (line.startsWith('```')) return true
  if (isHeadingLine(line)) return true
  if (isHorizontalRule(line)) return true
  if (line.startsWith('>')) return depth < MAX_BLOCKQUOTE_DEPTH
  if (unorderedOffset(line) > 0) return true
  if (orderedOffset(line) > 0) return true
  return false
}

function isBlockStart(line: string, depth: number, nextLine: string): boolean {
  // 表以外のブロックは先頭 1 文字でほぼ分かります。`|` は BLOCK_START_HEAD
  // に入れず、区切り行とセットのときだけ段落を止めます。
  if (isNonTableBlockStart(line, depth)) return true
  return isTableStart(line, nextLine)
}

// 行の境目に空白を入れるかどうかは、直前の文字だけで決まります。
// 連結済みの文字列から charAt で末尾を取ると、行が増えるほど文字列を
// 実体化しなおすことになり、段落の行数に対して二乗時間になります
// （`> 本文` を並べただけの原稿がそれです）。末尾の文字と長さを別に
// 持ち回り、断片は最後にまとめて join します。
function joinParagraphLines(lines: readonly string[]): string {
  // 1 行だけの段落が大半です。行の境目が無いので連結もいらず、末尾 2 スペースの
  // 目印も（次の行が無いので）付きません。trim の結果がそのまま答えになります。
  if (lines.length === 1) {
    return lineAt(lines, 0).trim()
  }

  const parts: string[] = []
  let chunkLength = 0
  let previousLast = ''

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lineAt(lines, i)
    const hardBreak = raw.endsWith('  ')
    const line = (hardBreak ? raw.slice(0, -2) : raw).trim()

    if (chunkLength > 0 && !isCjk(previousLast) && !isCjk(line.charAt(0))) {
      parts.push(' ')
      chunkLength += 1
      previousLast = ' '
    }
    parts.push(line)
    chunkLength += line.length
    /* v8 ignore next -- 段落に集まる行は空でないので trim しても空にならない */
    previousLast = line.length > 0 ? line.charAt(line.length - 1) : previousLast

    if (hardBreak && i < lines.length - 1) {
      parts.push(HARD_BREAK)
      chunkLength = 0
      previousLast = ''
    }
  }

  return parts.join('')
}

function isCjk(character: string): boolean {
  const code = character.charCodeAt(0)
  return (
    (code >= 0x3000 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  )
}

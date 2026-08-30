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

// 引用は入れ子にできるため renderMarkdown は自分を再帰呼び出しします。
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

export function renderMarkdown(source: string, depth = 0): string {
  return renderLines(stripHardBreakSentinel(normalizeNewlines(source)).split('\n'), depth)
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

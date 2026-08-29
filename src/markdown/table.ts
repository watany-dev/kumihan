import { renderInline } from './inline.js'

const PIPE = 0x7c
const COLON = 0x3a
const HYPHEN = 0x2d
const BACKTICK = 0x60
const BACKSLASH = 0x5c
const SPACE = 0x20
const TAB = 0x09

export type TableAlign = 'left' | 'center' | 'right' | null

/**
 * 表は段落に飲み込まれると行の境目が消えます。日本語のセルは
 * joinParagraphLines が空白を入れないので次の行とくっつき、コードスパンや
 * 強調は行をまたいで対になります。ヘッダと区切り行が揃ったときだけ表にします。
 */
export function isTableStart(header: string, delimiter: string): boolean {
  const alignments = parseAlignments(delimiter)
  if (!alignments) return false
  return splitTableRow(header).length === alignments.length
}

export function parseTable(
  lines: readonly string[],
  start: number,
  isRowEnd: (line: string) => boolean,
): { html: string; next: number } | null {
  const headerLine = lineAt(lines, start)
  const delimiterLine = lineAt(lines, start + 1)
  const alignments = parseAlignments(delimiterLine)
  if (!alignments) return null

  const headers = splitTableRow(headerLine)
  if (headers.length !== alignments.length) return null

  const columns = alignments.length
  const body: string[][] = []
  let i = start + 2

  while (i < lines.length) {
    const line = lineAt(lines, i)
    if (isRowEnd(line)) break
    body.push(fitRow(splitTableRow(line), columns))
    i += 1
  }

  return {
    html: renderTable(fitRow(headers, columns), alignments, body),
    next: i,
  }
}

function lineAt(lines: readonly string[], index: number): string {
  const line = lines[index]
  return typeof line === 'string' ? line : ''
}

function fitRow(cells: readonly string[], columns: number): string[] {
  const row = cells.slice(0, columns)
  while (row.length < columns) row.push('')
  return row
}

/**
 * セルは `|` で区切ります。行頭・行末の `|` は枠なので落とし、コードスパンの
 * 中と `\|` は区切りにしません。分割したあと `\|` は `|` に戻します。
 */
export function splitTableRow(line: string): string[] {
  const lo = leadingWidth(line)
  const hi = trailingStart(line)
  if (lo >= hi) return []

  let start = lo
  if (line.charCodeAt(lo) === PIPE) start = lo + 1

  const cells: string[] = []
  let cellStart = start
  let lastWasSplitter = false

  let i = start
  while (i < hi) {
    const code = line.charCodeAt(i)
    if (code === BACKTICK) {
      // 閉じられたコードスパンの中だけ `|` を区切りにしない。閉じが無ければ
      // この行のセル区切りを優先する。でないと `|` が次の行の ` まで届き、
      // 表全体が 1 つのコードスパンに飲み込まれます。
      const close = line.indexOf('`', i + 1)
      if (close !== -1 && close < hi) {
        lastWasSplitter = false
        i = close + 1
        continue
      }
      lastWasSplitter = false
      i += 1
      continue
    }
    if (code === BACKSLASH && i + 1 < hi) {
      lastWasSplitter = false
      i += 2
      continue
    }
    if (code === PIPE) {
      cells.push(unescapePipes(trimSlice(line, cellStart, i)))
      cellStart = i + 1
      lastWasSplitter = true
      i += 1
      continue
    }
    lastWasSplitter = false
    i += 1
  }

  if (!lastWasSplitter) {
    cells.push(unescapePipes(trimSlice(line, cellStart, hi)))
  }

  return cells
}

export function parseAlignments(line: string): TableAlign[] | null {
  if (line.indexOf('|') === -1) return null

  const cells = splitTableRow(line)
  if (cells.length === 0) return null

  const alignments: TableAlign[] = []
  for (let i = 0; i < cells.length; i += 1) {
    const alignment = alignmentOf(cells[i] ?? '')
    if (alignment === undefined) return null
    alignments.push(alignment)
  }
  return alignments
}

function alignmentOf(cell: string): TableAlign | undefined {
  if (cell.length < 3) return undefined

  let i = 0
  let left = false
  let right = false
  if (cell.charCodeAt(0) === COLON) {
    left = true
    i = 1
  }

  let dashes = 0
  while (i < cell.length && cell.charCodeAt(i) === HYPHEN) {
    dashes += 1
    i += 1
  }
  if (i < cell.length && cell.charCodeAt(i) === COLON) {
    right = true
    i += 1
  }
  if (i !== cell.length || dashes < 3) return undefined
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

function unescapePipes(cell: string): string {
  return cell.indexOf('\\|') === -1 ? cell : cell.replaceAll('\\|', '|')
}

function leadingWidth(line: string): number {
  let i = 0
  while (i < line.length) {
    const code = line.charCodeAt(i)
    if (code !== SPACE && code !== TAB) break
    i += 1
  }
  return i
}

function trailingStart(line: string): number {
  let i = line.length
  while (i > 0) {
    const code = line.charCodeAt(i - 1)
    if (code !== SPACE && code !== TAB) break
    i -= 1
  }
  return i
}

function trimSlice(line: string, start: number, end: number): string {
  let lo = start
  let hi = end
  while (lo < hi) {
    const code = line.charCodeAt(lo)
    if (code !== SPACE && code !== TAB) break
    lo += 1
  }
  while (hi > lo) {
    const code = line.charCodeAt(hi - 1)
    if (code !== SPACE && code !== TAB) break
    hi -= 1
  }
  return lo === 0 && hi === line.length ? line : line.slice(lo, hi)
}

function renderTable(
  headers: readonly string[],
  alignments: readonly TableAlign[],
  body: readonly string[][],
): string {
  let html = '<table>\n<thead>\n<tr>'
  html += renderCells('th', headers, alignments)
  html += '</tr>\n</thead>'

  if (body.length > 0) {
    html += '\n<tbody>'
    for (let r = 0; r < body.length; r += 1) {
      html += '\n<tr>'
      html += renderCells('td', body[r] ?? [], alignments)
      html += '</tr>'
    }
    html += '\n</tbody>'
  }

  return `${html}\n</table>`
}

function renderCells(
  tag: 'th' | 'td',
  cells: readonly string[],
  alignments: readonly TableAlign[],
): string {
  let html = ''
  for (let i = 0; i < cells.length; i += 1) {
    html += cellTag(tag, alignments[i] ?? null, cells[i] ?? '')
  }
  return html
}

function cellTag(tag: 'th' | 'td', align: TableAlign, text: string): string {
  const inner = renderInline(text)
  if (align === 'center') return `<${tag} class="align-center">${inner}</${tag}>`
  if (align === 'right') return `<${tag} class="align-right">${inner}</${tag}>`
  if (align === 'left') return `<${tag} class="align-left">${inner}</${tag}>`
  return `<${tag}>${inner}</${tag}>`
}

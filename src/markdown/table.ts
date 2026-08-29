import { renderInline } from './inline.js'

const PIPE = 0x7c
const COLON = 0x3a
const HYPHEN = 0x2d
const BACKTICK = 0x60
const BACKSLASH = 0x5c

export type TableAlign = 'left' | 'center' | 'right' | null

/** ヘッダと区切り行の列数が揃ったときだけ表にする。 */
export function isTableStart(header: string, delimiter: string): boolean {
  const alignments = parseAlignments(delimiter)
  return alignments !== null && splitTableRow(header).length === alignments.length
}

export function parseTable(
  lines: readonly string[],
  start: number,
  isRowEnd: (line: string) => boolean,
): { html: string; next: number } | null {
  const alignments = parseAlignments(lineAt(lines, start + 1))
  if (!alignments) return null

  const headers = splitTableRow(lineAt(lines, start))
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

  return { html: renderTable(fitRow(headers, columns), alignments, body), next: i }
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
 * 行頭・行末の `|` は枠。閉じられたコードスパンと `\|` は区切りにしない。
 * 閉じのない `` ` `` は行内の `|` を止めない（行をまたいで対にさせない）。
 */
export function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  if (trimmed.length === 0) return []

  const start = trimmed.charCodeAt(0) === PIPE ? 1 : 0
  const cells: string[] = []
  let cellStart = start
  let lastWasSplitter = false

  let i = start
  while (i < trimmed.length) {
    const code = trimmed.charCodeAt(i)
    if (code === BACKTICK) {
      const close = trimmed.indexOf('`', i + 1)
      if (close !== -1) {
        lastWasSplitter = false
        i = close + 1
        continue
      }
      lastWasSplitter = false
      i += 1
      continue
    }
    if (code === BACKSLASH && i + 1 < trimmed.length) {
      lastWasSplitter = false
      i += 2
      continue
    }
    if (code === PIPE) {
      cells.push(unescapePipes(trimmed.slice(cellStart, i).trim()))
      cellStart = i + 1
      lastWasSplitter = true
      i += 1
      continue
    }
    lastWasSplitter = false
    i += 1
  }

  if (!lastWasSplitter) {
    cells.push(unescapePipes(trimmed.slice(cellStart).trim()))
  }
  return cells
}

export function parseAlignments(line: string): TableAlign[] | null {
  if (!line.includes('|')) return null
  const cells = splitTableRow(line)
  if (cells.length === 0) return null

  const alignments: TableAlign[] = []
  for (const cell of cells) {
    const alignment = alignmentOf(cell)
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
  return cell.replaceAll('\\|', '|')
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
    for (const row of body) {
      html += `\n<tr>${renderCells('td', row, alignments)}</tr>`
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
  return `<${tag}>${inner}</${tag}>`
}

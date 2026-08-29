export const MAGAZINE_LINES_PER_PAGE = 40

/**
 * 2段組をおよそ 40 行の頁に分割する。ブロックの途中では切らない。
 *
 * ponytail: HTML 断片の改行数で詰める。折り返しや段の高さは見ない。
 * 視覚行がずれたら estimate を足す。
 */
export function paginateMagazine(html: string): string[] {
  const blocks = splitBlocks(html)
  if (blocks.length === 0) {
    return ['']
  }

  const pages: string[][] = []
  let current: string[] = []
  let used = 0

  for (const block of blocks) {
    const lines = lineCount(block)
    if (current.length > 0 && used + lines > MAGAZINE_LINES_PER_PAGE) {
      pages.push(current)
      current = []
      used = 0
    }
    current.push(block)
    used += lines
  }
  pages.push(current)

  return pages.map((page) => page.join('\n'))
}

function lineCount(html: string): number {
  let n = 1
  for (let i = 0; i < html.length; i += 1) {
    if (html.charCodeAt(i) === 10) {
      n += 1
    }
  }
  return n
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
  const name = tagName(html, start + 1)
  if (name.length === 0 || name === 'hr' || name === 'br' || html.charCodeAt(gt - 1) === 0x2f) {
    return gt + 1
  }

  const open = `<${name}`
  const close = `</${name}>`
  let depth = 1
  let i = gt + 1
  while (depth > 0) {
    const nextClose = html.indexOf(close, i)
    if (nextClose === -1) {
      return html.length
    }
    const nextOpen = html.indexOf(open, i)
    if (nextOpen !== -1 && nextOpen < nextClose && isNameEnd(html, nextOpen + open.length)) {
      depth += 1
      i = nextOpen + open.length
      continue
    }
    depth -= 1
    i = nextClose + close.length
  }
  return i
}

function tagName(html: string, from: number): string {
  let i = from
  if (html.charCodeAt(i) === 0x2f) {
    i += 1
  }
  const first = html.charCodeAt(i) | 0x20
  if (first < 0x61 || first > 0x7a) {
    return ''
  }
  const start = i
  i += 1
  while (i < html.length) {
    const c = html.charCodeAt(i)
    const lower = c | 0x20
    if ((lower < 0x61 || lower > 0x7a) && (c < 0x30 || c > 0x39)) {
      break
    }
    i += 1
  }
  return html.slice(start, i).toLowerCase()
}

function isNameEnd(html: string, index: number): boolean {
  const c = html.charCodeAt(index)
  return c === 0x3e || c === 0x20 || c === 0x2f || c === 0x0a || c === 0x09 || c === 0x0d
}

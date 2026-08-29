export const MAGAZINE_LINES_PER_PAGE = 40

// 2段の本文（9.5pt、段幅およそ 81mm）で 1 行に入る目安文字数。
const COLUMN_CHARS = 26
// 全幅要素（見出し・コード）の 1 行。
const FULL_CHARS = 54

const LT = 0x3c
const GT = 0x3e
const SLASH = 0x2f
const A_LOWER = 0x61
const Z_LOWER = 0x7a

interface PageAcc {
  blocks: string[]
  spanLines: number
  flowLines: number
}

interface BlockCost {
  html: string
  span: boolean
  lines: number
}

/**
 * 2段組をおよそ 40 行の頁に分割します。見出し・リード・コード・水平線は
 * 全幅、それ以外は 2 段に流れる前提で高さを見積もります。ブロックの途中では
 * 切りません。1 ブロックが 40 行を超えるときは、そのブロックだけで 1 頁にします。
 */
export function paginateMagazine(html: string): string[] {
  const blocks = splitTopLevelBlocks(html)
  if (blocks.length === 0) {
    return ['']
  }

  const pages: string[] = []
  let page = newPage()
  let i = 0

  while (i < blocks.length) {
    const group = nextGroup(blocks, i)
    const costs = costsFor(page, group)

    if (page.blocks.length > 0 && heightAfter(page, costs) > MAGAZINE_LINES_PER_PAGE) {
      pages.push(joinBlocks(page.blocks))
      page = newPage()
    }

    for (const cost of costsFor(page, group)) {
      addBlock(page, cost)
    }
    i += group.length
  }

  pages.push(joinBlocks(page.blocks))
  return pages
}

function blockAt(blocks: readonly string[], index: number): string {
  const block = blocks[index]
  /* v8 ignore next -- the caller stays inside 0..length-1 */
  return typeof block === 'string' ? block : ''
}

function newPage(): PageAcc {
  return { blocks: [], spanLines: 0, flowLines: 0 }
}

function heightAfter(page: PageAcc, costs: readonly BlockCost[]): number {
  let spanLines = page.spanLines
  let flowLines = page.flowLines
  for (const cost of costs) {
    if (cost.span) {
      spanLines += Math.ceil(flowLines / 2) + cost.lines
      flowLines = 0
    } else {
      flowLines += cost.lines
    }
  }
  return spanLines + Math.ceil(flowLines / 2)
}

function addBlock(page: PageAcc, cost: BlockCost): void {
  page.blocks.push(cost.html)
  if (cost.span) {
    page.spanLines += Math.ceil(page.flowLines / 2) + cost.lines
    page.flowLines = 0
  } else {
    page.flowLines += cost.lines
  }
}

function previousTag(page: PageAcc): string {
  if (page.blocks.length === 0) {
    return ''
  }
  return openingTagName(blockAt(page.blocks, page.blocks.length - 1))
}

function nextGroup(blocks: readonly string[], index: number): string[] {
  const block = blockAt(blocks, index)
  if (openingTagName(block) !== 'h1') {
    return [block]
  }
  const next = blocks[index + 1]
  if (typeof next === 'string' && openingTagName(next) === 'p') {
    return [block, next]
  }
  return [block]
}

function costsFor(page: PageAcc, group: readonly string[]): BlockCost[] {
  const costs: BlockCost[] = []
  let prev = previousTag(page)
  for (const html of group) {
    const tag = openingTagName(html)
    const span = isSpanningTag(tag) || (tag === 'p' && prev === 'h1')
    costs.push({ html, span, lines: estimateLines(html, span) })
    prev = tag
  }
  return costs
}

function isSpanningTag(tag: string): boolean {
  return tag === 'h1' || tag === 'pre' || tag === 'hr'
}

function joinBlocks(blocks: readonly string[]): string {
  let out = ''
  for (const block of blocks) {
    out = out.length === 0 ? block : `${out}\n${block}`
  }
  return out
}

function splitTopLevelBlocks(html: string): string[] {
  const blocks: string[] = []
  let i = 0
  const n = html.length

  while (i < n) {
    const code = html.charCodeAt(i)
    if (code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20) {
      i += 1
      continue
    }

    if (code !== LT) {
      const next = html.indexOf('<', i)
      const end = next === -1 ? n : next
      const text = html.slice(i, end).trim()
      if (text.length > 0) {
        blocks.push(text)
      }
      i = end
      continue
    }

    const end = readBlockEnd(html, i)
    blocks.push(html.slice(i, end))
    i = end
  }

  return blocks
}

function readBlockEnd(html: string, start: number): number {
  const name = readTagName(html, start + 1)
  const openEnd = html.indexOf('>', start + 1)
  if (openEnd === -1) {
    return html.length
  }

  if (name.length === 0 || isVoidTag(name) || html.charCodeAt(openEnd - 1) === SLASH) {
    return openEnd + 1
  }

  return findMatchingClose(html, openEnd + 1, name)
}

function readTagName(html: string, from: number): string {
  let i = from
  if (html.charCodeAt(i) === SLASH) {
    i += 1
  }
  const first = html.charCodeAt(i) | 0x20
  if (first < A_LOWER || first > Z_LOWER) {
    return ''
  }
  const start = i
  i += 1
  while (i < html.length) {
    const c = html.charCodeAt(i)
    const lower = c | 0x20
    const letter = lower >= A_LOWER && lower <= Z_LOWER
    const digit = c >= 0x30 && c <= 0x39
    if (!letter && !digit) {
      break
    }
    i += 1
  }
  return html.slice(start, i).toLowerCase()
}

function openingTagName(html: string): string {
  return html.charCodeAt(0) === LT ? readTagName(html, 1) : ''
}

function isVoidTag(name: string): boolean {
  return name === 'hr' || name === 'br'
}

function isTagNameEnd(html: string, index: number): boolean {
  const c = html.charCodeAt(index)
  return c === GT || c === 0x20 || c === SLASH || c === 0x0a || c === 0x09 || c === 0x0d
}

function findMatchingClose(html: string, from: number, tag: string): number {
  const openNeedle = `<${tag}`
  const closeNeedle = `</${tag}>`
  let depth = 1
  let i = from

  while (i < html.length && depth > 0) {
    const nextClose = html.indexOf(closeNeedle, i)
    if (nextClose === -1) {
      return html.length
    }

    const nextOpen = html.indexOf(openNeedle, i)
    if (
      nextOpen !== -1 &&
      nextOpen < nextClose &&
      isTagNameEnd(html, nextOpen + openNeedle.length)
    ) {
      depth += 1
      i = nextOpen + openNeedle.length
      continue
    }

    depth -= 1
    i = nextClose + closeNeedle.length
  }

  return i
}

function estimateLines(html: string, span: boolean): number {
  const tag = openingTagName(html)
  const width = span ? FULL_CHARS : COLUMN_CHARS

  if (tag === 'h1') {
    return 2 + wrappedLines(textContent(html), 22)
  }
  if (tag === 'h2') {
    return 2 + wrappedLines(textContent(html), width)
  }
  if (tag === 'h3') {
    return 1 + wrappedLines(textContent(html), width)
  }
  if (tag === 'hr') {
    return 3
  }
  if (tag === 'pre') {
    return 2 + wrappedLines(textContent(html), FULL_CHARS)
  }
  if (tag === 'blockquote') {
    return 1 + wrappedLines(textContent(html), width)
  }
  if (tag === 'ul' || tag === 'ol') {
    return listLines(html)
  }
  if (tag === 'p') {
    return 1 + wrappedLines(textContent(html), width)
  }
  return Math.max(1, wrappedLines(textContent(html), width))
}

function listLines(html: string): number {
  let lines = 0
  let i = 0

  for (;;) {
    const start = html.indexOf('<li>', i)
    if (start === -1) {
      break
    }
    const end = html.indexOf('</li>', start + 4)
    if (end === -1) {
      lines += wrappedLines(textContent(html.slice(start)), COLUMN_CHARS)
      break
    }
    lines += wrappedLines(textContent(html.slice(start, end + 5)), COLUMN_CHARS)
    i = end + 5
  }

  return lines === 0 ? 1 : lines + 1
}

function textContent(html: string): string {
  let out = ''
  let i = 0

  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      out += html.slice(i)
      break
    }
    out += html.slice(i, lt)
    const gt = html.indexOf('>', lt + 1)
    if (gt === -1) {
      break
    }
    if (readTagName(html, lt + 1) === 'br') {
      out += '\n'
    }
    i = gt + 1
  }

  return out
}

function wrappedLines(text: string, width: number): number {
  let lines = 0
  let start = 0
  const n = text.length

  for (let i = 0; i <= n; i += 1) {
    if (i !== n && text.charCodeAt(i) !== 0x0a) {
      continue
    }
    const len = i - start
    lines += len <= 0 ? 1 : Math.ceil(len / width)
    start = i + 1
  }

  return lines
}

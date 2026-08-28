import { escapeHtml } from './escape.js'
import { renderInline } from './inline.js'

const HARD_BREAK = '\u0001'

// HARD_BREAK は段落の強制改行を表す内部の目印です。原稿に同じ文字が
// 紛れていると escapeHtml をすり抜けて生の <br> になってしまうので、
// 目印として使う前に入力から取り除きます。
function stripHardBreakSentinel(text: string): string {
  if (!text.includes(HARD_BREAK)) {
    return text
  }
  return text.replaceAll(HARD_BREAK, '')
}

function lineAt(lines: readonly string[], index: number): string {
  const line = lines[index]
  if (typeof line === 'string') {
    return line
  }
  /* v8 ignore next -- String#split produces a dense array */
  return ''
}

export function renderMarkdown(source: string): string {
  const lines = stripHardBreakSentinel(source.replace(/\r\n?/g, '\n')).split('\n')
  const blocks: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lineAt(lines, i)

    if (isBlank(line)) {
      i += 1
      continue
    }

    if (line.startsWith('```')) {
      const parsed = parseFencedCode(lines, i)
      blocks.push(parsed.html)
      i = parsed.next
      continue
    }

    const heading = parseHeading(line)
    if (heading) {
      blocks.push(heading)
      i += 1
      continue
    }

    if (isHorizontalRule(line)) {
      blocks.push('<hr>')
      i += 1
      continue
    }

    if (line.startsWith('>')) {
      const parsed = parseBlockquote(lines, i)
      blocks.push(parsed.html)
      i = parsed.next
      continue
    }

    if (line.startsWith('- ')) {
      const parsed = parseList(lines, i, 'ul', /^- /)
      blocks.push(parsed.html)
      i = parsed.next
      continue
    }

    if (/^\d+\. /.test(line)) {
      const parsed = parseList(lines, i, 'ol', /^\d+\. /)
      blocks.push(parsed.html)
      i = parsed.next
      continue
    }

    const parsed = parseParagraph(lines, i)
    blocks.push(parsed.html)
    i = parsed.next
  }

  return blocks.join('\n')
}

const HEADING = /^(#{1,3}) (.+)$/

function parseHeading(line: string): string | null {
  const match = HEADING.exec(line)
  if (!match) {
    return null
  }

  const markers = match[1]
  const text = match[2]
  /* v8 ignore next -- the heading regex always captures both groups */
  if (markers === undefined || text === undefined) return null
  const level = markers.length
  return `<h${level}>${renderInline(text.trim())}</h${level}>`
}

const BLANK = /^\s*$/
const HORIZONTAL_RULE = /^\s*-{3,}\s*$/

function isBlank(line: string): boolean {
  return line.length === 0 || BLANK.test(line)
}

function isHorizontalRule(line: string): boolean {
  return HORIZONTAL_RULE.test(line)
}

function parseFencedCode(lines: string[], start: number): { html: string; next: number } {
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

function parseBlockquote(lines: string[], start: number): { html: string; next: number } {
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

  const innerHtml = renderMarkdown(inner.join('\n'))
  return {
    html: `<blockquote>\n${innerHtml}\n</blockquote>`,
    next: i,
  }
}

function parseList(
  lines: string[],
  start: number,
  tag: 'ul' | 'ol',
  marker: RegExp,
): { html: string; next: number } {
  const items: string[] = []
  let i = start

  while (i < lines.length) {
    const line = lineAt(lines, i)
    if (!marker.test(line)) {
      break
    }
    items.push(`<li>${renderInline(line.replace(marker, ''))}</li>`)
    i += 1
  }

  return {
    html: `<${tag}>\n${items.join('\n')}\n</${tag}>`,
    next: i,
  }
}

function parseParagraph(lines: string[], start: number): { html: string; next: number } {
  const collected: string[] = []
  let i = start

  while (i < lines.length) {
    const line = lineAt(lines, i)
    if (isBlank(line) || isBlockStart(line)) {
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
  const html = renderInline(joined).replaceAll(HARD_BREAK, '<br>')
  return {
    html: `<p>${html}</p>`,
    next: i,
  }
}

// ブロックを開始しうる先頭文字（水平線は字下げを許すため空白も含む）。
// 段落の大半はこの 1 回の判定だけで抜けられます。
const BLOCK_START_HEAD = /^[`#\->\d\s]/

function isBlockStart(line: string): boolean {
  if (!BLOCK_START_HEAD.test(line)) return false
  if (line.startsWith('```')) return true
  if (HEADING.test(line)) return true
  if (isHorizontalRule(line)) return true
  if (line.startsWith('>')) return true
  if (line.startsWith('- ')) return true
  if (/^\d+\. /.test(line)) return true
  return false
}

function joinParagraphLines(lines: string[]): string {
  let result = ''
  let chunk = ''

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lineAt(lines, i)
    const hardBreak = raw.endsWith('  ')
    const line = (hardBreak ? raw.slice(0, -2) : raw).trim()

    chunk = chunk.length === 0 ? line : concatenateSoftBreak(chunk, line)

    if (hardBreak && i < lines.length - 1) {
      result += `${chunk}${HARD_BREAK}`
      chunk = ''
    }
  }

  return result + chunk
}

function concatenateSoftBreak(previous: string, next: string): string {
  const last = previous.charAt(previous.length - 1)
  const first = next.charAt(0)
  if (isCjk(last) || isCjk(first)) {
    return previous + next
  }

  return `${previous} ${next}`
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

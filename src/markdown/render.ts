import { escapeHtml } from './escape.js'
import { renderInline } from './inline.js'

const HARD_BREAK = '\u0001'

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    if (line.trim() === '') {
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

function parseHeading(line: string): string | null {
  const match = /^(#{1,3}) (.+)$/.exec(line)
  if (!match) {
    return null
  }

  const level = match[1]?.length ?? 1
  const text = (match[2] ?? '').trim()
  return `<h${level}>${renderInline(text)}</h${level}>`
}

function isHorizontalRule(line: string): boolean {
  return /^-{3,}$/.test(line.trim())
}

function parseFencedCode(lines: string[], start: number): { html: string; next: number } {
  const body: string[] = []
  let i = start + 1

  while (i < lines.length && !lines[i]?.startsWith('```')) {
    body.push(lines[i] ?? '')
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

  while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
    let content = (lines[i] ?? '').slice(1)
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

  while (i < lines.length && marker.test(lines[i] ?? '')) {
    const text = (lines[i] ?? '').replace(marker, '')
    items.push(`<li>${renderInline(text)}</li>`)
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

  while (i < lines.length && (lines[i] ?? '').trim() !== '' && !isBlockStart(lines[i] ?? '')) {
    collected.push(lines[i] ?? '')
    i += 1
  }

  const joined = joinParagraphLines(collected)
  const html = renderInline(joined).replaceAll(HARD_BREAK, '<br>')
  return {
    html: `<p>${html}</p>`,
    next: i,
  }
}

function isBlockStart(line: string): boolean {
  if (line.startsWith('```')) return true
  if (/^#{1,3} /.test(line)) return true
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
    const raw = lines[i] ?? ''
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
  if (previous.length === 0) return next
  if (next.length === 0) return previous

  const last = previous[previous.length - 1] ?? ''
  const first = next[0] ?? ''
  if (isCjk(last) || isCjk(first)) {
    return previous + next
  }

  return `${previous} ${next}`
}

function isCjk(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  return (
    (code >= 0x3000 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  )
}

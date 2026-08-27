import { escapeHtml, sanitizeUrl } from './escape.js'

export function renderInline(source: string): string {
  let i = 0
  let html = ''

  while (i < source.length) {
    const code = parseInlineCode(source, i)
    if (code) {
      html += `<code>${escapeHtml(code.text)}</code>`
      i = code.end
      continue
    }

    const link = parseLink(source, i)
    if (link) {
      const href = escapeHtml(sanitizeUrl(link.url))
      html += `<a href="${href}">${renderInline(link.text)}</a>`
      i = link.end
      continue
    }

    const strong = parseDelimited(source, i, '**')
    if (strong) {
      html += `<strong>${renderInline(strong.text)}</strong>`
      i = strong.end
      continue
    }

    const emphasis = parseDelimited(source, i, '*')
    if (emphasis) {
      html += `<em>${renderInline(emphasis.text)}</em>`
      i = emphasis.end
      continue
    }

    html += escapeHtml(source[i] ?? '')
    i += 1
  }

  return html
}

function parseInlineCode(
  source: string,
  start: number,
): { text: string; end: number } | null {
  if (source[start] !== '`') {
    return null
  }

  const close = source.indexOf('`', start + 1)
  if (close === -1 || close === start + 1) {
    return null
  }

  return {
    text: source.slice(start + 1, close),
    end: close + 1,
  }
}

function parseLink(
  source: string,
  start: number,
): { text: string; url: string; end: number } | null {
  if (source[start] !== '[') {
    return null
  }

  const mid = source.indexOf('](', start + 1)
  if (mid === -1) {
    return null
  }

  const end = source.indexOf(')', mid + 2)
  if (end === -1) {
    return null
  }

  return {
    text: source.slice(start + 1, mid),
    url: source.slice(mid + 2, end),
    end: end + 1,
  }
}

function parseDelimited(
  source: string,
  start: number,
  delimiter: string,
): { text: string; end: number } | null {
  if (!source.startsWith(delimiter, start)) {
    return null
  }

  const close = source.indexOf(delimiter, start + delimiter.length)
  if (close === -1 || close === start + delimiter.length) {
    return null
  }

  return {
    text: source.slice(start + delimiter.length, close),
    end: close + delimiter.length,
  }
}

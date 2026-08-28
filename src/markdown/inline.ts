import { escapeHtml, sanitizeUrl } from './escape.js'

const BACKTICK = 0x60
const BRACKET_OPEN = 0x5b
const ASTERISK = 0x2a

/**
 * インライン記法を開始しうる文字の次の位置を返します。それ以外の文字は
 * どの記法にもならないため、まとめてエスケープできます。
 */
function nextMarkerIndex(source: string, from: number): number {
  for (let i = from; i < source.length; i += 1) {
    const code = source.charCodeAt(i)
    if (code === BACKTICK || code === BRACKET_OPEN || code === ASTERISK) {
      return i
    }
  }
  return source.length
}

export function renderInline(source: string): string {
  let i = 0
  let html = ''

  while (i < source.length) {
    const marker = nextMarkerIndex(source, i)
    if (marker > i) {
      html += escapeHtml(source.slice(i, marker))
      i = marker
      if (i === source.length) break
    }

    // ここに来る文字は必ず `\``・`[`・`*` のいずれかなので、
    // 対応する記法だけを試します。
    const parsed = parseMarker(source, i)
    if (parsed) {
      html += parsed.html
      i = parsed.end
      continue
    }

    html += escapeHtml(source.charAt(i))
    i += 1
  }

  return html
}

function parseMarker(source: string, start: number): { html: string; end: number } | null {
  const marker = source.charCodeAt(start)

  if (marker === BACKTICK) {
    const code = parseDelimited(source, start, '`')
    return code ? { html: `<code>${escapeHtml(code.text)}</code>`, end: code.end } : null
  }

  if (marker === BRACKET_OPEN) {
    const link = parseLink(source, start)
    if (!link) return null
    return {
      html: `<a href="${escapeHtml(sanitizeUrl(link.url))}">${renderInline(link.text)}</a>`,
      end: link.end,
    }
  }

  const strong = parseDelimited(source, start, '**')
  if (strong) {
    return { html: `<strong>${renderInline(strong.text)}</strong>`, end: strong.end }
  }

  const emphasis = parseDelimited(source, start, '*')
  return emphasis ? { html: `<em>${renderInline(emphasis.text)}</em>`, end: emphasis.end } : null
}

/** 呼び出し元は `source[start]` が `[` であることを保証します。 */
function parseLink(
  source: string,
  start: number,
): { text: string; url: string; end: number } | null {
  const mid = source.indexOf('](', start + 1)
  if (mid === -1) return null
  const end = source.indexOf(')', mid + 2)
  if (end === -1) return null
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
  if (!source.startsWith(delimiter, start)) return null
  const close = source.indexOf(delimiter, start + delimiter.length)
  if (close === -1 || close === start + delimiter.length) return null
  return {
    text: source.slice(start + delimiter.length, close),
    end: close + delimiter.length,
  }
}

import { escapeHtml, sanitizeUrl } from './escape.js'
import { HARD_BREAK } from './hard-break.js'

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

/**
 * 閉じ記号が「これ以降には存在しない」位置。閉じ記号を探す indexOf は
 * 見つからないと末尾まで走るので、閉じられない記号が並んだ原稿
 * （`[[[[…`）では 1 文字ごとに全体を走査して二乗時間になります。
 * 最後の出現位置を一度だけ求めておき、その先では探索を省きます。
 */
interface CloserLimits {
  backtick: number
  double: number
  asterisk: number
  linkMid: number
  linkEnd: number
}

function closerLimits(source: string): CloserLimits {
  return {
    backtick: source.lastIndexOf('`'),
    double: source.lastIndexOf('**'),
    asterisk: source.lastIndexOf('*'),
    linkMid: source.lastIndexOf(']('),
    linkEnd: source.lastIndexOf(')'),
  }
}

export function renderInline(source: string): string {
  const limits = closerLimits(source)
  let i = 0
  let html = ''

  while (i < source.length) {
    const marker = nextMarkerIndex(source, i)
    if (marker > i) {
      html += renderText(source.slice(i, marker))
      i = marker
      if (i === source.length) break
    }

    // ここに来る文字は必ず `\``・`[`・`*` のいずれかなので、
    // 対応する記法だけを試します。
    const parsed = parseMarker(source, i, limits)
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

// 地の文だけが強制改行の目印を <br> にできます。コードスパンや URL の
// 中身は文字どおりに扱うので、ここを通らずに別の処理へ回します。
function renderText(text: string): string {
  const escaped = escapeHtml(text)
  return escaped.includes(HARD_BREAK) ? escaped.replaceAll(HARD_BREAK, '<br>') : escaped
}

function parseMarker(
  source: string,
  start: number,
  limits: CloserLimits,
): { html: string; end: number } | null {
  const marker = source.charCodeAt(start)

  if (marker === BACKTICK) {
    const code = start < limits.backtick ? parseDelimited(source, start, '`') : null
    // コードスパンの中身は文字どおり。改行だった場所は空白に戻します。
    return code ? { html: `<code>${escapeHtml(literal(code.text))}</code>`, end: code.end } : null
  }

  if (marker === BRACKET_OPEN) {
    const link = start < limits.linkMid ? parseLink(source, start, limits) : null
    if (!link) return null
    // URL の中身も文字どおり。目印のまま sanitizeUrl へ渡すと制御文字と
    // みなされ、行またぎの URL がすべて `#` に落ちてしまいます。
    return {
      html: `<a href="${escapeHtml(sanitizeUrl(literal(link.url)))}">${renderInline(link.text)}</a>`,
      end: link.end,
    }
  }

  const strong = start + 2 <= limits.double ? parseDelimited(source, start, '**') : null
  if (strong) {
    return { html: `<strong>${renderInline(strong.text)}</strong>`, end: strong.end }
  }

  const emphasis = start < limits.asterisk ? parseDelimited(source, start, '*') : null
  return emphasis ? { html: `<em>${renderInline(emphasis.text)}</em>`, end: emphasis.end } : null
}

function literal(text: string): string {
  return text.includes(HARD_BREAK) ? text.replaceAll(HARD_BREAK, ' ') : text
}

// URL に空白は入りません。ここを緩めると `[x](` のあとに閉じ括弧が
// 出てくるまで、段落の何行分でも href に吸い込まれて本文が消えます。
// 目印（強制改行）も、元は行末の空白なので同じ扱いにします。
const URL_SEPARATOR = new RegExp(`[\\s${HARD_BREAK}]`)

/**
 * 呼び出し元は `source[start]` が `[` であること、および `](` が
 * この先に残っていること（CloserLimits）を保証します。
 */
function parseLink(
  source: string,
  start: number,
  limits: CloserLimits,
): { text: string; url: string; end: number } | null {
  const mid = source.indexOf('](', start + 1)
  /* v8 ignore next -- 呼び出し元が `](` の存在を確かめている */
  if (mid === -1) return null
  // 閉じ括弧が残っていないのに indexOf を呼ぶと、`[a](b` を並べた原稿で
  // `[` ごとに末尾まで走ることになり二乗時間になります。
  if (mid + 2 > limits.linkEnd) return null
  const end = source.indexOf(')', mid + 2)
  /* v8 ignore next -- linkEnd を確かめているので必ず見つかる */
  if (end === -1) return null
  const url = source.slice(mid + 2, end)
  // `(` が残っているなら括弧が釣り合っていません。`[x]([y](z)` のような
  // 書きかけを URL とみなすと、そこにあった本文ごと href に消えます。
  if (URL_SEPARATOR.test(url) || url.includes('(')) return null
  const text = source.slice(start + 1, mid)
  // `]` が残っているなら、この `[` はもっと手前で閉じています。
  // `[a] b [c](d)` の `[a] b ` までリンクの文字にしてはいけません。
  if (text.includes(']')) return null
  return {
    text,
    url,
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

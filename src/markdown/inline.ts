import { escapeHtml, sanitizeImageUrl, sanitizeUrl } from './escape.js'
import { HARD_BREAK } from './hard-break.js'

const BACKTICK = 0x60
const BRACKET_OPEN = 0x5b
const ASTERISK = 0x2a
const BANG = 0x21
const BRACKET_CLOSE = 0x5d
const PAREN_OPEN = 0x28

/**
 * インライン記法を開始しうる文字の次の位置を返します。それ以外の文字は
 * どの記法にもならないため、まとめてエスケープできます。
 */
function nextMarkerIndex(source: string, from: number): number {
  for (let i = from; i < source.length; i += 1) {
    const code = source.charCodeAt(i)
    if (code === BACKTICK || code === BRACKET_OPEN || code === ASTERISK || code === BANG) {
      return i
    }
  }
  return source.length
}

/**
 * 閉じ記号を探す indexOf は、見つからないと末尾まで走ります。閉じられない
 * 記号が並んだ原稿（`[[[[…`）では 1 文字ごとに全体を走査して二乗時間に
 * なるため、空振りした記号を覚えておき、その先では探索そのものを省きます。
 *
 * 「位置 x から見つからなければ x より後ろのどこからでも見つからない」ので、
 * この記憶は探索を省いても結果を変えません。記号ごとに空振りは高々 1 回で、
 * 全体の走査量は原稿の長さに比例したままです。
 *
 * 開始時に lastIndexOf でまとめて限界位置を求める手もありますが、それだと
 * 空振りが 1 度も起きない普通の原稿でも毎回 4 回の全走査を先払いになります。
 * renderInline は強調やリンクの中身で再帰するので、この先払いは短い断片ごとに
 * 積み上がります。実測ではここが全体の約 2 割を占めていました。
 */
interface ClosersExhausted {
  backtick: boolean
  double: boolean
  asterisk: boolean
  linkMid: boolean
  linkEnd: boolean
  // 直前に見つけた `](` と、その先の `)` の位置。リンクの形が整っていても
  // URL として認めない場合（空白や釣り合わない括弧）は 1 文字進んで
  // やり直すので、そのたびに探し直すとまた二乗時間になります。start が
  // midAt より手前なら、その間に `](` は無いと分かっているので使い回せます。
  midAt: number
  endAt: number
}

export function renderInline(source: string): string {
  const exhausted: ClosersExhausted = {
    backtick: false,
    double: false,
    asterisk: false,
    linkMid: false,
    linkEnd: false,
    midAt: -1,
    endAt: -1,
  }
  let i = 0
  let html = ''

  while (i < source.length) {
    const marker = nextMarkerIndex(source, i)
    if (marker > i) {
      html += renderText(source.slice(i, marker))
      i = marker
      if (i === source.length) break
    }

    // ここに来る文字は必ず `\``・`[`・`*`・`!` のいずれかなので、
    // 対応する記法だけを試します。
    const parsed = parseMarker(source, i, exhausted)
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
  exhausted: ClosersExhausted,
): { html: string; end: number } | null {
  const marker = source.charCodeAt(start)

  if (marker === BACKTICK) {
    const code = parseDelimited(source, start, '`', exhausted, 'backtick')
    // コードスパンの中身は文字どおり。改行だった場所は空白に戻します。
    return code ? { html: `<code>${escapeHtml(literal(code.text))}</code>`, end: code.end } : null
  }

  if (marker === BANG && source.charCodeAt(start + 1) === BRACKET_OPEN) {
    const image = parseLink(source, start + 1, exhausted)
    return image ? { html: renderImage(image.text, image.url), end: image.end } : null
  }

  if (marker === BRACKET_OPEN) {
    // `[![alt](src)](href)` は、先に内側の `](` を拾うと画像にならない。
    if (source.startsWith('![', start + 1)) {
      const linked = parseLinkedImage(source, start, exhausted)
      if (linked) return linked
      return null
    }
    const link = parseLink(source, start, exhausted)
    if (!link) return null
    // URL の中身も文字どおり。目印のまま sanitizeUrl へ渡すと制御文字と
    // みなされ、行またぎの URL がすべて `#` に落ちてしまいます。
    return {
      html: `<a href="${escapeHtml(sanitizeUrl(literal(link.url)))}">${renderInline(link.text)}</a>`,
      end: link.end,
    }
  }

  const strong = parseDelimited(source, start, '**', exhausted, 'double')
  if (strong) {
    return { html: `<strong>${renderInline(strong.text)}</strong>`, end: strong.end }
  }

  const emphasis = parseDelimited(source, start, '*', exhausted, 'asterisk')
  return emphasis ? { html: `<em>${renderInline(emphasis.text)}</em>`, end: emphasis.end } : null
}

function literal(text: string): string {
  return text.includes(HARD_BREAK) ? text.replaceAll(HARD_BREAK, ' ') : text
}

function renderImage(alt: string, url: string): string {
  return `<img src="${escapeHtml(sanitizeImageUrl(literal(url)))}" alt="${escapeHtml(literal(alt))}">`
}

// URL の区切りになる文字。空白と、強制改行の目印（元は行末の空白）。
const URL_SEPARATOR = new RegExp(`[\\s${HARD_BREAK}]`)

function parseLinkedImage(
  source: string,
  start: number,
  exhausted: ClosersExhausted,
): { html: string; end: number } | null {
  const image = parseLink(source, start + 2, exhausted)
  if (!image) return null
  if (
    source.charCodeAt(image.end) !== BRACKET_CLOSE ||
    source.charCodeAt(image.end + 1) !== PAREN_OPEN
  ) {
    return null
  }
  const urlStart = image.end + 2
  const urlEnd = source.indexOf(')', urlStart)
  if (urlEnd === -1) return null
  const url = source.slice(urlStart, urlEnd)
  if (URL_SEPARATOR.test(url) || url.includes('(')) return null
  return {
    html: `<a href="${escapeHtml(sanitizeUrl(literal(url)))}">${renderImage(image.text, image.url)}</a>`,
    end: urlEnd + 1,
  }
}

/**
 * 呼び出し元は `source[start]` が `[` であることを保証します。
 *
 * `](` と `)` を別々に覚えるのは、`[a](` を並べた原稿だと `](` は毎回すぐ
 * 見つかる一方で `)` の探索だけが末尾まで空振りし、そこだけが二乗時間に
 * なるためです。
 */
function parseLink(
  source: string,
  start: number,
  exhausted: ClosersExhausted,
): { text: string; url: string; end: number } | null {
  if (exhausted.linkMid || exhausted.linkEnd) return null

  let mid = exhausted.midAt
  let end = exhausted.endAt
  if (mid <= start) {
    mid = source.indexOf('](', start + 1)
    if (mid === -1) {
      exhausted.linkMid = true
      return null
    }

    end = source.indexOf(')', mid + 2)
    if (end === -1) {
      exhausted.linkEnd = true
      return null
    }

    exhausted.midAt = mid
    exhausted.endAt = end
  }

  const url = source.slice(mid + 2, end)
  // URL に空白は入りません。ここを緩めると `[x](` のあとに閉じ括弧が
  // 出てくるまで、段落の何行分でも href に吸い込まれて本文が消えます。
  // 目印（強制改行）も、元は行末の空白なので同じ扱いにします。
  // `(` が残っているのは括弧が釣り合っていないとき。`[x]([y](z)` のような
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
  exhausted: ClosersExhausted,
  key: 'backtick' | 'double' | 'asterisk',
): { text: string; end: number } | null {
  if (exhausted[key]) return null
  if (!source.startsWith(delimiter, start)) return null

  const close = source.indexOf(delimiter, start + delimiter.length)
  if (close === -1) {
    exhausted[key] = true
    return null
  }
  // 空の記法（`**` や `` `` ``）は記法として成立しませんが、閉じ記号自体は
  // 見つかっているので「もう無い」とは記録しません。
  if (close === start + delimiter.length) return null

  return {
    text: source.slice(start + delimiter.length, close),
    end: close + delimiter.length,
  }
}

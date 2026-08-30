const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const ESCAPABLE = /["&'<>]/
const ESCAPABLE_GLOBAL = /["&'<>]/g

export function escapeHtml(text: string): string {
  if (!ESCAPABLE.test(text)) {
    return text
  }

  /* v8 ignore next -- the character class only matches keys of ESCAPES */
  return text.replace(ESCAPABLE_GLOBAL, (character) => ESCAPES[character] ?? character)
}

/**
 * C0 制御文字を含むなら true。あわせて、空白を含むかどうかも返します。
 *
 * どちらも 1 文字ずつ見れば分かるので、走査は 1 回で足ります。空白が無ければ
 * 詰めた文字列を作る必要もありません（URL のほとんどがこちらです）。
 */
function scanUrl(text: string): { control: boolean; space: boolean } {
  let space = false
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return { control: true, space }
    }
    if (!space && isNonControlSpace(code)) {
      space = true
    }
  }
  return { control: false, space }
}

// 正規表現の `\s` のうち、C0 制御文字（別に弾いている）を除いたもの。
// URL の大半は ASCII なので、まず 1 回の比較で抜けられるようにします。
function isNonControlSpace(code: number): boolean {
  if (code < 0x80) {
    return code === 0x20
  }
  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  )
}

const COLON = 0x3a
const PLUS = 0x2b
const DOT = 0x2e
const HYPHEN = 0x2d

function isAlpha(code: number): boolean {
  return (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a)
}

function isSchemeTail(code: number): boolean {
  return (
    isAlpha(code) ||
    (code >= 0x30 && code <= 0x39) ||
    code === PLUS ||
    code === DOT ||
    code === HYPHEN
  )
}

/**
 * `/^([a-zA-Z][a-zA-Z0-9+.-]*):/` と同じ判定で、スキームの終端（`:` の位置）を
 * 返します。スキームが無ければ -1。文字クラスに `:` は入っていないので、
 * 貪欲な繰り返しが止まった位置が `:` でなければ、後戻りしても一致しません。
 * つまりこの走査は正規表現と同じ結果になり、マッチ結果を確保せずに済みます。
 */
function schemeEnd(url: string): number {
  if (!isAlpha(url.charCodeAt(0))) {
    return -1
  }

  let i = 1
  while (i < url.length && isSchemeTail(url.charCodeAt(i))) {
    i += 1
  }
  return url.charCodeAt(i) === COLON ? i : -1
}

// スキーム名を小文字化せずに比べます。スキームに使える文字のうち、`| 0x20` で
// 小文字の範囲（0x61-0x7a）に化けるのは A-Z だけなので、取り違えは起きません。
function schemeIs(url: string, end: number, name: string): boolean {
  if (end !== name.length) {
    return false
  }
  for (let i = 0; i < end; i += 1) {
    if ((url.charCodeAt(i) | 0x20) !== name.charCodeAt(i)) {
      return false
    }
  }
  return true
}

export function sanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.length === 0) {
    return '#'
  }

  const scanned = scanUrl(trimmed)
  if (scanned.control) {
    return '#'
  }

  // スキームの判定は空白を詰めた文字列で行います（`java  script:` を
  // 通さないため）。返すのは詰める前の文字列です。
  const compact = scanned.space ? trimmed.replace(/\s+/g, '') : trimmed
  const end = schemeEnd(compact)
  if (
    end === -1 ||
    schemeIs(compact, end, 'https') ||
    schemeIs(compact, end, 'http') ||
    schemeIs(compact, end, 'mailto')
  ) {
    return trimmed
  }

  return '#'
}

/**
 * 画像の src。sanitizeUrl のあと、http / https / スキーム無しだけ残す。
 * mailto と `#fragment` はリンクには使えるが src にはしない。
 */
export function sanitizeImageUrl(url: string): string {
  const sanitized = sanitizeUrl(url)
  if (sanitized.startsWith('#')) {
    return '#'
  }

  const compact = sanitized.replace(/\s+/g, '')
  const end = schemeEnd(compact)
  if (end === -1 || schemeIs(compact, end, 'https') || schemeIs(compact, end, 'http')) {
    return sanitized
  }

  return '#'
}

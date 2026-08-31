import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { escapeHtml, sanitizeImageUrl, sanitizeUrl, unescapeHtml } from '../src/markdown/escape.js'
import { HARD_BREAK } from '../src/markdown/hard-break.js'
import { renderInline } from '../src/markdown/inline.js'
import { renderMarkdown } from '../src/markdown/render.js'
import { MAGAZINE_LAYOUT, type PageLayout, paginate } from '../src/typesetting/paginate.js'

// ファジングは「たまたま当たった入力」を試します。ここでは逆に、記法を作る
// 記号だけの小さなアルファベットを決めて、その長さまでの入力を *全部* 通します。
// 数え上げが終われば、その範囲に反例が無いことを言い切れます。
//
// 見るのは 3 つの性質です。
//   1. 出力の `<` と `>` は、renderer が出したタグの区切りだけである（不変条件）
//   2. 手書きの走査は、コメントが名乗る正規表現と同じ答えを出す（詳細化）
//   3. renderInline の空振り記憶は、記憶なしの実装と同じ答えを出す（詳細化）

// ---------------------------------------------------------------------------
// 1. 出力の不変条件
// ---------------------------------------------------------------------------

const VOID_ELEMENTS = new Set(['br', 'hr', 'img'])

// renderer が出しうる要素と、その要素に許した属性。これ以外が出力に現れたら、
// 原稿の文字がタグとして解釈されたということです。
const ELEMENTS = new Map<string, ReadonlySet<string>>([
  ['p', new Set()],
  ['h1', new Set()],
  ['h2', new Set()],
  ['h3', new Set()],
  ['strong', new Set()],
  ['em', new Set()],
  ['code', new Set()],
  ['pre', new Set()],
  ['br', new Set()],
  ['hr', new Set()],
  ['ul', new Set()],
  ['ol', new Set()],
  ['li', new Set()],
  ['blockquote', new Set()],
  ['table', new Set()],
  ['thead', new Set()],
  ['tbody', new Set()],
  ['tr', new Set()],
  ['th', new Set(['class'])],
  ['td', new Set(['class'])],
  ['a', new Set(['href'])],
  ['img', new Set(['src', 'alt'])],
])

const SAFE_HREF_SCHEME = new Set(['http', 'https', 'mailto'])
const SAFE_SRC_SCHEME = new Set(['http', 'https'])

// ブラウザが href / src をどう読むかの模型です。タブと改行はどこにあっても
// 取り除かれ、前後の C0 と空白は削られ、その先頭がスキームになります。
// sanitizeUrl の実装ではなく、通したくない相手の側から書いています。
function browserScheme(url: string): string | null {
  const stripped = url.replaceAll(/[\t\n\r]/g, '')
  // ブラウザが実際に削る範囲を写しているので、制御文字は意図どおりです。
  // oxlint-disable-next-line no-control-regex
  const trimmed = stripped.replaceAll(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  return match === null ? null : (match[1] ?? '').toLowerCase()
}

/** 出力に紛れ込んだ、renderer が出したのではない HTML を挙げます。 */
function injections(html: string): string[] {
  let i = 0
  while (i < html.length) {
    const character = html.charAt(i)
    if (character === '>') return [`地の文に生の '>' が残った (${i})`]
    if (character !== '<') {
      i += 1
      continue
    }

    const opening = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(i))
    if (opening === null) return [`タグにならない '<' が残った (${i})`]
    const name = (opening[1] ?? '').toLowerCase()
    const attributes = ELEMENTS.get(name)
    if (attributes === undefined) return [`知らない要素 <${name}> (${i})`]
    const closing = html.charAt(i + 1) === '/'
    if (closing && VOID_ELEMENTS.has(name)) return [`空要素に閉じタグ </${name}>`]

    let j = i + opening[0].length
    while (j < html.length && html.charAt(j) !== '>') {
      if (html.charAt(j) === ' ') {
        j += 1
        continue
      }
      const attribute = /^([a-zA-Z-]+)="([^"]*)"/.exec(html.slice(j))
      if (attribute === null) return [`属性の形になっていない (${j})`]
      const attributeName = (attribute[1] ?? '').toLowerCase()
      const value = attribute[2] ?? ''
      if (closing || !attributes.has(attributeName)) {
        return [`<${name}> に許していない属性 ${attributeName}`]
      }
      if (attributeName === 'href' || attributeName === 'src') {
        const scheme = browserScheme(unescapeHtml(value))
        const allowed = attributeName === 'href' ? SAFE_HREF_SCHEME : SAFE_SRC_SCHEME
        if (scheme !== null && !allowed.has(scheme)) {
          return [`${attributeName} に ${scheme}: が入った (${JSON.stringify(value)})`]
        }
      }
      j += attribute[0].length
    }
    if (j >= html.length) return [`閉じられていないタグ <${name}>`]
    i = j + 1
  }
  return []
}

/** アルファベットから作れる、長さ max までの入力を全部 fn に渡します。 */
function enumerate(alphabet: readonly string[], max: number, fn: (input: string) => void): number {
  let count = 0
  const walk = (prefix: string, depth: number): void => {
    if (depth === 0) {
      count += 1
      fn(prefix)
      return
    }
    for (const token of alphabet) walk(prefix + token, depth - 1)
  }
  for (let length = 1; length <= max; length += 1) walk('', length)
  return count
}

const ALPHABETS: Record<string, readonly string[]> = {
  インライン: ['`', '*', '[', ']', '(', ')', '!', '<', '&', '"', 'x', ':', ' '],
  URL: ['[', '](', ')', 'j', ':', HARD_BREAK, ' ', '\u00a0', '/', '"', '&', '#', '!'],
  ブロック: ['#', '>', '-', '|', ':', ' ', '\n', '`', 'x', '<', '*', '['],
  表: ['|', '---', ':---:', '\n', 'a', '`', '\\|', '<', '*', '[', '](', ')'],
}

// ブロックごとに、あるいは数ブロックごとに切れる小さな頁。
const TINY_PAGES: PageLayout[] = [
  { ...MAGAZINE_LAYOUT, lines: 1, columns: 1 },
  { ...MAGAZINE_LAYOUT, lines: 3, columns: 1 },
]

describe('数え上げ検査: 出力に注入は現れない', () => {
  for (const [name, alphabet] of Object.entries(ALPHABETS)) {
    it(`${name}記法のすべての組み合わせ`, () => {
      const tested = enumerate(alphabet, 4, (source) => {
        const html = renderMarkdown(source)
        assert.deepEqual(injections(html), [], `${JSON.stringify(source)} -> ${html}`)

        // 頁分けは出来上がった HTML を切り分けます。要素の途中で切ると
        // 属性の外に文字が出てしまうので、切ったあとも同じ性質を求めます。
        for (const perPage of TINY_PAGES) {
          for (const page of paginate(html, perPage)) {
            assert.deepEqual(
              injections(page),
              [],
              `${JSON.stringify(source)} を ${perPage.lines} 行で分割 -> ${page}`,
            )
          }
        }
      })
      assert.ok(tested > 20000, `数え上げた入力が少なすぎる: ${tested}`)
    })
  }
})

// ---------------------------------------------------------------------------
// 2. 手書き走査と、コメントが名乗る正規表現の一致
// ---------------------------------------------------------------------------

// escape.ts の走査は「正規表現と同じ結果になる」と書いたうえで、正規表現を
// 使わずに書かれています。速さのための書き換えなので、仕様のほうを素直な
// 正規表現で置き、答えが割れないことを数え上げで確かめます。

function referenceEscapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function referenceSanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.length === 0) return '#'
  // 制御文字を弾くのが目的の判定です。
  // oxlint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return '#'
  const compact = trimmed.replaceAll(/\s+/g, '')
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact)
  if (match === null) return trimmed
  return SAFE_HREF_SCHEME.has((match[1] ?? '').toLowerCase()) ? trimmed : '#'
}

function referenceSanitizeImageUrl(url: string): string {
  const sanitized = referenceSanitizeUrl(url)
  if (sanitized.startsWith('#')) return '#'
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(sanitized.replaceAll(/\s+/g, ''))
  if (match === null) return sanitized
  return SAFE_SRC_SCHEME.has((match[1] ?? '').toLowerCase()) ? sanitized : '#'
}

describe('詳細化検査: 手書きの走査は正規表現と同じ答えを出す', () => {
  it('escapeHtml と、その逆の往復', () => {
    const alphabet = ['&', '<', '>', '"', "'", 'a', ';', '#', '3', '9', 'l', 't', 'm', 'p', ' ']
    enumerate(alphabet, 4, (input) => {
      assert.equal(escapeHtml(input), referenceEscapeHtml(input), input)
      // 書き出しは <img src> から元のパスを取り戻します。往復が崩れると、
      // プレビューには出る画像が書き出しにだけ無い、という食い違いになります。
      assert.equal(unescapeHtml(escapeHtml(input)), input, input)
    })
  })

  it('sanitizeUrl / sanitizeImageUrl', () => {
    // スキームを組み立てる文字に、空白として畳まれる文字を混ぜます。
    // `java script:` のような、詰めると危なくなる形を作るためです。
    const alphabet = [
      'h',
      't',
      'p',
      's',
      'm',
      'a',
      'i',
      'l',
      'j',
      'v',
      'c',
      'r',
      'o',
      ':',
      '+',
      '.',
      '-',
      '0',
      '/',
      '#',
      ' ',
      '\t',
      '\n',
      '\u00a0',
      '\u3000',
      '\ufeff',
      HARD_BREAK,
      'H',
      'S',
    ]
    enumerate(alphabet, 3, (input) => {
      assert.equal(sanitizeUrl(input), referenceSanitizeUrl(input), JSON.stringify(input))
      assert.equal(sanitizeImageUrl(input), referenceSanitizeImageUrl(input), JSON.stringify(input))
    })
  })
})

// ---------------------------------------------------------------------------
// 3. 空振り記憶（ClosersExhausted）を外した実装との一致
// ---------------------------------------------------------------------------

// renderInline は、閉じ記号が見つからなかったことを覚えて探索を省きます。
// 「位置 x から見つからなければ x より後ろのどこからでも見つからない」という
// 理屈ですが、これが少しでも崩れると、リンクの範囲がずれて本文が href へ
// 吸い込まれます。記憶を持たない素朴な実装を並べ、答えを突き合わせます。

const URL_SEPARATOR = new RegExp(`[\\s${HARD_BREAK}]`)

function literal(text: string): string {
  return text.includes(HARD_BREAK) ? text.replaceAll(HARD_BREAK, ' ') : text
}

function referenceParseLink(
  source: string,
  start: number,
): { text: string; url: string; end: number } | null {
  const mid = source.indexOf('](', start + 1)
  if (mid === -1) return null
  const end = source.indexOf(')', mid + 2)
  if (end === -1) return null
  const url = source.slice(mid + 2, end)
  if (URL_SEPARATOR.test(url) || url.includes('(')) return null
  const text = source.slice(start + 1, mid)
  if (text.includes(']')) return null
  return { text, url, end: end + 1 }
}

function referenceParseDelimited(
  source: string,
  start: number,
  delimiter: string,
): { text: string; end: number } | null {
  if (!source.startsWith(delimiter, start)) return null
  const close = source.indexOf(delimiter, start + delimiter.length)
  if (close === -1 || close === start + delimiter.length) return null
  return { text: source.slice(start + delimiter.length, close), end: close + delimiter.length }
}

function referenceRenderInline(source: string): string {
  let i = 0
  let html = ''
  while (i < source.length) {
    const character = source.charAt(i)
    let consumed = false

    if (character === '`') {
      const code = referenceParseDelimited(source, i, '`')
      if (code) {
        html += `<code>${escapeHtml(literal(code.text))}</code>`
        i = code.end
        consumed = true
      }
    } else if (character === '!' && source.charAt(i + 1) === '[') {
      const image = referenceParseLink(source, i + 1)
      if (image) {
        const src = escapeHtml(sanitizeImageUrl(literal(image.url)))
        html += `<img src="${src}" alt="${escapeHtml(literal(image.text))}">`
        i = image.end
        consumed = true
      }
    } else if (character === '[') {
      const link = referenceParseLink(source, i)
      if (link) {
        const href = escapeHtml(sanitizeUrl(literal(link.url)))
        html += `<a href="${href}">${referenceRenderInline(link.text)}</a>`
        i = link.end
        consumed = true
      }
    } else if (character === '*') {
      const strong = referenceParseDelimited(source, i, '**')
      if (strong) {
        html += `<strong>${referenceRenderInline(strong.text)}</strong>`
        i = strong.end
        consumed = true
      } else {
        const emphasis = referenceParseDelimited(source, i, '*')
        if (emphasis) {
          html += `<em>${referenceRenderInline(emphasis.text)}</em>`
          i = emphasis.end
          consumed = true
        }
      }
    }

    if (!consumed) {
      const escaped = escapeHtml(character)
      html += escaped === HARD_BREAK ? '<br>' : escaped
      i += 1
    }
  }
  return html
}

describe('詳細化検査: 空振り記憶は答えを変えない', () => {
  it('記号だけで作れる入力すべてで、記憶あり／なしが一致する', () => {
    const alphabet = ['`', '*', '[', ']', '(', ')', '](', '!', 'a', ' ', '<', ':', '#', '"']
    const tested = enumerate(alphabet, 4, (input) => {
      assert.equal(renderInline(input), referenceRenderInline(input), JSON.stringify(input))
    })
    assert.ok(tested > 40000, `数え上げた入力が少なすぎる: ${tested}`)
  })
})

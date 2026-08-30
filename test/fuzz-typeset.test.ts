import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { renderMarkdown } from '../src/markdown/render.js'
import {
  MAGAZINE_LINES_PER_PAGE,
  PRINT_LINES_PER_PAGE,
  paginate,
} from '../src/typesetting/paginate.js'
import { renderDocument, type PreviewMode } from '../src/typesetting/render-page.js'

// v0.1.0 のあとに入った頁分け（#23 の 1段組と、2段組）を機械的に揺さぶります。
// 頁分けは本文を切り分けるだけなので、どんな原稿でも次の 3 つが成り立つはずです。
// 本文が増えも減りもしないこと、タグの列が変わらないこと、そして 1 頁ずつ見ても
// タグが閉じていること（ブロックの途中で切っていないこと）。種は固定です。

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const INLINE = [
  '`',
  '**',
  '*',
  '[',
  '](',
  ')',
  ']',
  'a',
  'あ',
  '<',
  '&',
  '"',
  "'",
  ' ',
  '![',
  '![a](b.png)',
  '![a',
  '](img.png)',
  '!',
  '</p>',
  '<blockquote>',
  '|',
  '\\|',
  'text ',
  '[![i](i.png)](https://example.com)',
]
const PREFIX = ['', '# ', '## ', '### ', '> ', '> > ', '- ', '1. ', '```', '---', '| ', '  ', '\t']
const LINE_ENDING = ['\n', '\n', '\n', '\r\n', '\r']

function generate(seed: number): string {
  const rand = mulberry32(seed)
  const lines: string[] = []
  const count = 1 + Math.floor(rand() * 60)
  for (let l = 0; l < count; l += 1) {
    let line = PREFIX[Math.floor(rand() * PREFIX.length)] ?? ''
    const parts = Math.floor(rand() * 8)
    for (let p = 0; p < parts; p += 1) {
      line += INLINE[Math.floor(rand() * INLINE.length)] ?? ''
    }
    // 行末の 2 スペース（強制改行）を混ぜる。頁の行数に効く。
    if (rand() < 0.3) line += '  '
    lines.push(line)
  }

  let source = ''
  for (let l = 0; l < lines.length; l += 1) {
    source += lines[l] ?? ''
    if (l < lines.length - 1) source += LINE_ENDING[Math.floor(rand() * LINE_ENDING.length)] ?? '\n'
  }
  return source
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'meta', 'link'])

/** タグが順番どおり閉じているか。頁の途中でブロックを切ると崩れる。 */
function unbalanced(html: string): string[] {
  const problems: string[] = []
  const open: string[] = []
  let i = 0

  while (i < html.length) {
    if (html.charAt(i) !== '<') {
      i += 1
      continue
    }
    if (html.startsWith('<!', i)) {
      const end = html.indexOf('>', i)
      i = end === -1 ? html.length : end + 1
      continue
    }
    const end = html.indexOf('>', i)
    const raw = end === -1 ? html.slice(i) : html.slice(i, end + 1)
    const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)>$/.exec(raw)
    if (!match) {
      problems.push(`タグとして読めない: ${JSON.stringify(raw.slice(0, 40))}`)
      i += 1
      continue
    }
    const name = (match[2] ?? '').toLowerCase()
    i += raw.length
    if (VOID_TAGS.has(name)) continue
    if (match[1] === '/') {
      const top = open.pop()
      if (top !== name) problems.push(`入れ子が合わない: </${name}> に対して <${top ?? 'なし'}>`)
      continue
    }
    open.push(name)
  }
  if (open.length > 0) problems.push(`閉じていないタグ: ${open.join(',')}`)
  return problems
}

/** タグを除いた地の文。空白の入れ方は頁分けで変わるので詰めて比べる。 */
function textOnly(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, '')
}

/** タグだけを順に並べたもの。要素が消えたり増えたりしていないか見る。 */
function tagStream(html: string): string {
  return (html.match(/<[^>]*>/g) ?? []).join('')
}

const MODES: PreviewMode[] = ['print', 'magazine', 'web']

describe('typesetting fuzzing', () => {
  it('keeps every page well formed and loses nothing', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const source = generate(seed * 2654435761)
      const html = renderMarkdown(source)
      const context = `seed ${seed} / 入力 ${JSON.stringify(source.slice(0, 200))}`

      for (const size of [1, PRINT_LINES_PER_PAGE, MAGAZINE_LINES_PER_PAGE]) {
        const pages = paginate(html, size)
        assert.ok(pages.length > 0, context)
        const joined = pages.join('\n')
        assert.equal(textOnly(joined), textOnly(html), `${size} 行: 本文が変わった。${context}`)
        assert.equal(tagStream(joined), tagStream(html), `${size} 行: タグ列が変わった。${context}`)
        for (const page of pages) {
          assert.deepEqual(unbalanced(page), [], `${size} 行: ${context}`)
        }
      }
    }
  })

  it('renders a well formed document in every mode', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const source = generate(seed * 40503)
      const html = renderMarkdown(source)
      const context = `seed ${seed} / 入力 ${JSON.stringify(source.slice(0, 200))}`
      for (const mode of MODES) {
        const document = renderDocument(html, { mode })
        assert.deepEqual(unbalanced(document), [], `${mode}: ${context}`)
        if (textOnly(html).length > 0) {
          const body = document.slice(document.indexOf('<body'))
          assert.ok(textOnly(body).length > 0, `${mode}: 本文が消えた。${context}`)
        }
      }
    }
  })

  it('renders the same pages for the same input', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const html = renderMarkdown(generate(seed * 2246822519))
      assert.deepEqual(
        paginate(html, MAGAZINE_LINES_PER_PAGE),
        paginate(html, MAGAZINE_LINES_PER_PAGE),
      )
    }
  })
})

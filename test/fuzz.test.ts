import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { renderMarkdown } from '../src/markdown/render.js'

// 記法を混ぜた原稿を機械的に作り、出力の HTML が満たすべき性質を確かめます。
// 個別の期待値を並べるのではなく「どんな入力でも壊れないこと」を見るので、
// 記法どうしの思わぬ組み合わせが引っかかります。種は固定なので再現します。

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

const INLINE = ['`', '**', '*', '[', '](', ')', ']', 'a', 'あ', '<', '&', '"', "'", ' ', 'x:']
const PREFIX = ['', '# ', '## ', '### ', '> ', '>', '- ', '1. ', '```', '---', '  ', '\t']

function generate(seed: number): string {
  const rand = mulberry32(seed)
  const lines: string[] = []
  const lineCount = 1 + Math.floor(rand() * 10)
  for (let l = 0; l < lineCount; l += 1) {
    let line = PREFIX[Math.floor(rand() * PREFIX.length)] ?? ''
    const parts = Math.floor(rand() * 10)
    for (let p = 0; p < parts; p += 1) {
      line += INLINE[Math.floor(rand() * INLINE.length)] ?? ''
    }
    // 行末の 2 スペース（強制改行）を混ぜる。
    if (rand() < 0.35) line += '  '
    lines.push(line)
  }
  return lines.join('\n')
}

const VOID_TAGS = new Set(['br', 'hr'])
const ALLOWED_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'hr',
  'br',
  'blockquote',
  'ul',
  'ol',
  'li',
  'pre',
  'code',
  'strong',
  'em',
  'a',
])

interface ParsedTag {
  name: string
  raw: string
  attributes: string
  closing: boolean
}

/** 出力をタグと地の文に分ける。エスケープ漏れはここで見つかる。 */
function parseHtml(html: string): { tags: ParsedTag[]; text: string; problems: string[] } {
  const tags: ParsedTag[] = []
  const problems: string[] = []
  let text = ''
  let i = 0

  while (i < html.length) {
    const character = html.charAt(i)
    if (character === '<') {
      const close = html.indexOf('>', i)
      const raw = close === -1 ? html.slice(i) : html.slice(i, close + 1)
      const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)>$/.exec(raw)
      if (!match) {
        problems.push(`エスケープされていない '<': ${JSON.stringify(raw.slice(0, 40))}`)
        text += character
        i += 1
        continue
      }
      tags.push({
        name: (match[2] ?? '').toLowerCase(),
        raw,
        attributes: match[3] ?? '',
        closing: match[1] === '/',
      })
      i += raw.length
      continue
    }
    if (character === '>') {
      problems.push("エスケープされていない '>'")
    }
    text += character
    i += 1
  }

  return { tags, text, problems }
}

function findProblems(html: string): string[] {
  const { tags, text, problems } = parseHtml(html)
  const open: string[] = []

  for (const tag of tags) {
    if (!ALLOWED_TAGS.has(tag.name)) {
      problems.push(`許可していないタグ: <${tag.name}>`)
    }
    if (!tag.closing && tag.name !== 'a' && tag.attributes.trim() !== '') {
      problems.push(`想定していない属性: ${tag.raw}`)
    }
    if (VOID_TAGS.has(tag.name)) {
      if (tag.closing) problems.push(`空要素の閉じタグ: ${tag.raw}`)
      continue
    }
    if (tag.closing) {
      const top = open.pop()
      if (top !== tag.name) {
        problems.push(`入れ子が合わない: </${tag.name}> に対して <${top ?? 'なし'}>`)
      }
    } else {
      open.push(tag.name)
    }
  }
  if (open.length > 0) {
    problems.push(`閉じていないタグ: ${open.join(',')}`)
  }

  for (const tag of tags) {
    if (tag.name !== 'a' || tag.closing) continue
    const href = /^\shref="([^"]*)"$/.exec(tag.attributes)?.[1]
    if (href === undefined) {
      problems.push(`href の形が不正: ${tag.raw}`)
      continue
    }
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href.replace(/\s+/g, ''))?.[1]?.toLowerCase()
    if (scheme !== undefined && !['http', 'https', 'mailto'].includes(scheme)) {
      problems.push(`危険なスキームの href: ${JSON.stringify(href)}`)
    }
  }

  // コードスパンと コードブロックの中身は文字どおりでなければならない。
  const code = /<code>([\s\S]*?)<\/code>/g
  let match: RegExpExecArray | null
  while ((match = code.exec(html)) !== null) {
    if (/<[a-zA-Z/]/.test(match[1] ?? '')) {
      problems.push(`<code> の中に生のタグ: ${JSON.stringify((match[1] ?? '').slice(0, 40))}`)
    }
  }

  // 強制改行の内部目印が出力へ漏れていないこと。
  if (html.includes('\u0001')) {
    problems.push('内部の目印 U+0001 が出力に漏れた')
  }

  if (text.replace(/&(amp|lt|gt|quot|#39);/g, '').includes('&')) {
    problems.push("エスケープされていない '&'")
  }

  return problems
}

function measureUnclosedBrackets(size: number): number {
  const input = '['.repeat(size)
  renderMarkdown(input)
  const started = performance.now()
  renderMarkdown(input)
  return performance.now() - started
}

describe('markdown fuzzing', () => {
  it('keeps the generated HTML well formed and escaped', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const source = generate(seed * 2654435761)
      const problems = findProblems(renderMarkdown(source))
      assert.deepEqual(problems, [], `seed ${seed} / 入力 ${JSON.stringify(source)}`)
    }
  })

  it('renders the same output for the same input', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const source = generate(seed * 40503)
      assert.equal(renderMarkdown(source), renderMarkdown(source))
    }
  })

  it('does not turn a hard break inside a code span into a tag', () => {
    assert.equal(renderMarkdown('`a  \nb`'), '<p><code>a b</code></p>')
    assert.equal(renderMarkdown('`a  \nb`  \nc'), '<p><code>a b</code><br>c</p>')
    // 地の文の強制改行はこれまでどおり <br> になる。
    assert.equal(renderMarkdown('a  \nb'), '<p>a<br>b</p>')
    assert.equal(renderMarkdown('**a  \nb**'), '<p><strong>a<br>b</strong></p>')
  })

  it('does not rescan the whole line for every unclosed marker', () => {
    // 閉じられない記号が並ぶ原稿で二乗時間にならないこと。
    // 入力を 8 倍にしても、線形なら 8 倍前後に収まる。
    const small = Math.max(measureUnclosedBrackets(20_000), 0.5)
    const large = measureUnclosedBrackets(160_000)
    assert.ok(large < small * 40, `20000 文字 ${small}ms に対して 160000 文字 ${large}ms`)
  })
})

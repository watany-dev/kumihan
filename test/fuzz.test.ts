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

const INLINE = [
  '`',
  '**',
  '*',
  '***',
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
  '\u0001',
  'x:',
  'javascript:',
  '|',
  '\\|',
]
const PREFIX = ['', '# ', '## ', '### ', '> ', '>', '- ', '1. ', '```', '---', '  ', '\t', '| ']
const LINE_ENDING = ['\n', '\n', '\r\n', '\r']

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

  // 改行コードも混ぜる。CR だけの原稿でも結果は変わらないはず。
  let source = ''
  for (let l = 0; l < lines.length; l += 1) {
    source += lines[l] ?? ''
    if (l < lines.length - 1) source += LINE_ENDING[Math.floor(rand() * LINE_ENDING.length)] ?? '\n'
  }
  return source
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
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
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
    if (!tag.closing && tag.attributes.trim() !== '') {
      if (tag.name === 'a') {
        // href は後で見る。
      } else if (
        (tag.name === 'th' || tag.name === 'td') &&
        /^\sclass="align-(left|center|right)"$/.test(tag.attributes)
      ) {
        // 表の揃え。
      } else {
        problems.push(`想定していない属性: ${tag.raw}`)
      }
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

function measureQuotedLines(lines: number): number {
  const input = '> ab\n'.repeat(lines)
  renderMarkdown(input)
  const started = performance.now()
  renderMarkdown(input)
  return performance.now() - started
}

function measureUnclosedLinks(count: number): number {
  const input = '[a](b'.repeat(count)
  renderMarkdown(input)
  const started = performance.now()
  renderMarkdown(input)
  return performance.now() - started
}

function measureUnclosedBrackets(size: number): number {
  const input = '['.repeat(size)
  renderMarkdown(input)
  const started = performance.now()
  renderMarkdown(input)
  return performance.now() - started
}

// `](` はすぐ見つかるのに `)` だけが末尾まで空振りする形。`](` の有無だけを
// 見ていると、この原稿でリンクごとに全体を走査して二乗時間になる。
function measureUnclosedParens(size: number): number {
  const input = '[a]('.repeat(size)
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

  it('does not let a URL swallow the text after it', () => {
    // URL に空白は入らない。閉じ括弧を探して段落の残りを href に
    // 吸い込むと、そこにあった本文が出力から消えてしまう。
    assert.equal(renderMarkdown('[x]( あ い) 続き'), '<p>[x]( あ い) 続き</p>')
    // 行をまたいだ `(` も同じ。リンクにはならず、本文はそのまま残る。
    assert.equal(renderMarkdown('[a](b\nc)'), '<p>[a](b c)</p>')
    assert.equal(renderMarkdown('[a](b  \nc)'), '<p>[a](b<br>c)</p>')
    // 空白を挟んだスキームでリンクを作らせることもできない。
    assert.equal(renderMarkdown('[a](java  \nscript:x)'), '<p>[a](java<br>script:x)</p>')
    // 壊れたリンクの直後にある正しいリンクは、これまでどおり組める。
    assert.equal(
      renderMarkdown('[a](b c) [d](https://e)'),
      '<p>[a](b c) <a href="https://e">d</a></p>',
    )
  })

  it('does not let unbalanced brackets stretch a link', () => {
    // `(` が閉じていない URL は URL ではない。書きかけのリンクに
    // 続きのリンクを飲み込ませると、そこにあった本文が消える。
    assert.equal(
      renderMarkdown('[あ]([い](https://e/i)'),
      '<p>[あ](<a href="https://e/i">い</a></p>',
    )
    assert.equal(renderMarkdown('[a](b(c))'), '<p>[a](b(c))</p>')
    // `[a]` はここで閉じている。後ろのリンクの文字にしてはいけない。
    assert.equal(renderMarkdown('[a] b [c](d)'), '<p>[a] b <a href="d">c</a></p>')
  })

  it('does not scan to the end of the line for every unclosed link', () => {
    // 閉じ括弧のない `[a](b` を並べた原稿で二乗時間にならないこと。
    const small = Math.max(measureUnclosedLinks(10_000), 0.5)
    const large = measureUnclosedLinks(80_000)
    assert.ok(large < small * 40, `10000 個 ${small}ms に対して 80000 個 ${large}ms`)
  })

  it('does not rescan the whole line for every link left unclosed', () => {
    // `[a](` を並べた原稿で二乗時間にならないこと。
    const small = Math.max(measureUnclosedParens(20_000), 0.5)
    const large = measureUnclosedParens(160_000)
    assert.ok(large < small * 40, `20000 個 ${small}ms に対して 160000 個 ${large}ms`)
  })

  it('does not re-scan the joined paragraph for every line', () => {
    // 行を連ねた段落（`> 本文` を並べた原稿など）で二乗時間にならないこと。
    const small = Math.max(measureQuotedLines(4_000), 0.5)
    const large = measureQuotedLines(32_000)
    assert.ok(large < small * 40, `4000 行 ${small}ms に対して 32000 行 ${large}ms`)
  })
})

// 記法を組み合わせた原稿を作り、「本文が出力から消えていないこと」を見ます。
// 語そのものは記号を含まないので、リンクや強調の解釈がどう転んでも、
// 本文か href のどちらかには必ず残っていなければなりません。
const WORDS = ['a', 'bc', 'あ', '日本', 'Z9', 'ん']
const SHAPES = [
  (w: string) => w,
  (w: string) => `\`${w}\``,
  (w: string) => `**${w}**`,
  (w: string) => `*${w}*`,
  (w: string) => `[${w}](https://example.com/${w})`,
  (w: string) => `[${w}](${w})`,
  (w: string) => `[${w}](`,
  (w: string) => `[${w}]( ${w})`,
  (w: string) => `${w}]`,
  (w: string) => `${w})`,
  (w: string) => `**${w}*`,
]
const LEADS = ['', '# ', '## ', '> ', '- ', '1. ', '> - ', '| ']

function buildDocument(rand: () => number): { source: string; words: string[] } {
  const words: string[] = []
  const lines: string[] = []
  const lineCount = 1 + Math.floor(rand() * 6)
  for (let l = 0; l < lineCount; l += 1) {
    let line = LEADS[Math.floor(rand() * LEADS.length)] ?? ''
    const parts = 1 + Math.floor(rand() * 4)
    for (let p = 0; p < parts; p += 1) {
      const word = WORDS[Math.floor(rand() * WORDS.length)] ?? 'a'
      const shape = SHAPES[Math.floor(rand() * SHAPES.length)] ?? ((w: string) => w)
      words.push(word)
      line += shape(word)
      if (rand() < 0.4) line += ' '
    }
    if (rand() < 0.2) line += '  '
    lines.push(line)
    if (rand() < 0.3) lines.push('')
  }
  return { source: lines.join('\n'), words }
}

/** タグを外して地の文にする。href の中身も「残っている」とみなす。 */
function visibleText(html: string): string {
  return html
    .replace(/<a href="([^"]*)">/g, ' $1 ')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

describe('markdown fuzzing (本文の保存)', () => {
  it('never drops manuscript text', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const rand = mulberry32(seed * 2654435761)
      const { source, words } = buildDocument(rand)
      const text = visibleText(renderMarkdown(source))
      for (const word of words) {
        assert.ok(
          text.includes(word),
          `seed ${seed}: ${JSON.stringify(word)} が消えた / 入力 ${JSON.stringify(source)}`,
        )
      }
    }
  })

  it('renders blank-line separated blocks independently', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const rand = mulberry32(seed * 40503)
      const { source } = buildDocument(rand)
      if (source.includes('```')) continue
      const blocks = source.split('\n\n').filter((block) => block.trim() !== '')
      if (blocks.length < 2) continue
      assert.equal(
        blocks.map((block) => renderMarkdown(block)).join('\n'),
        renderMarkdown(blocks.join('\n\n')),
        `seed ${seed} / 入力 ${JSON.stringify(source)}`,
      )
    }
  })
})

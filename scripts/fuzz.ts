/**
 * v0.2.0-preview 以降に入った機能へのファジング。
 *
 * テストに入れているファジング（`test/fuzz*.test.ts`）は CI が毎回回すので、
 * 件数を数千に抑えています。ここはその外側で、桁を上げて回すためのものです。
 * 既定は 100 万件で、種を渡せば同じ列が再現します。
 *
 *   bun run fuzz
 *   bun run fuzz -- --cases 50000 --only image,svg
 *   bun run fuzz -- --seed 12345
 *
 * 揺さぶる相手（v0.2.0-preview 以降）:
 *
 *   image     画像ファイルの実寸読み取り（`image-size.ts`）
 *   svg       同上の SVG 経路。文字列なので別に厚く回す
 *   measure   断片への寸法の書き入れ（`measure-images.ts`。実ファイルを読む）
 *   typeset   頁分け（ブロック種別ごとの高さ、2段の折り返し、泣き別れの送り）
 *   segment   区画分け（`segments.ts`）と、区画単位の変換の一致
 *   diff      区画差分（`block-diff.ts`）
 *   document  ノンブル・柱つきの組み上げ（`render-page.ts`）
 *   http      差分ビューを含むプレビューの経路（実際の git リポジトリで）
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { createPreviewApp } from '../src/app.js'
import { diffSegments, renderBlockDiff } from '../src/diff/block-diff.js'
import {
  normalizeMarkdown,
  renderMarkdown,
  renderMarkdownPiece,
  resetRenderCache,
} from '../src/markdown/render.js'
import { splitSegments } from '../src/markdown/segments.js'
import { imageSize } from '../src/typesetting/image-size.js'
import { withImageSizes } from '../src/typesetting/measure-images.js'
import {
  MAGAZINE_LAYOUT,
  PRINT_LAYOUT,
  paginate,
  splitBlocks,
  type PageLayout,
} from '../src/typesetting/paginate.js'
import { renderDocument, type PreviewMode } from '../src/typesetting/render-page.js'

// ===== 乱数 =====

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

type Rand = () => number

function pick<T>(rand: Rand, items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)]
  /* 空の一覧は渡しません。 */
  if (item === undefined) throw new Error('pick from an empty list')
  return item
}

function upto(rand: Rand, limit: number): number {
  return Math.floor(rand() * limit)
}

// ===== 失敗の記録 =====

class Failures {
  readonly found: { kind: string; seed: number; detail: string }[] = []

  check(condition: boolean, kind: string, seed: number, detail: () => string): void {
    if (condition) return
    if (this.found.length < 40) {
      this.found.push({ kind, seed, detail: detail() })
    }
  }

  guard(kind: string, seed: number, run: () => void): void {
    try {
      run()
    } catch (error) {
      this.check(false, `${kind}/throw`, seed, () => String(error).slice(0, 400))
    }
  }
}

// 1 件あたりに許す時間。二乗時間や暴走する正規表現はここに引っかかります。
const SLOW_MS = 250

// ===== 画像のバイト列 =====

function noise(rand: Rand, length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) bytes[i] = upto(rand, 256)
  return bytes
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const part of parts) total += part.length
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff
  return out
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function jpegBytes(rand: Rand): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])]
  const segments = upto(rand, 6)
  for (let i = 0; i < segments; i += 1) {
    const marker = pick(rand, [0xe0, 0xdb, 0xc0, 0xc2, 0xc4, 0xda, 0xd9, 0xff, 0x01, 0x00])
    const length = upto(rand, 40)
    parts.push(new Uint8Array([0xff, marker, (length >> 8) & 0xff, length & 0xff]))
    parts.push(noise(rand, upto(rand, 20)))
  }
  return concat(parts)
}

function isoBytes(rand: Rand): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0, 0, 0, 0x18]), ascii('ftyp'), ascii('avif')]
  const boxes = upto(rand, 5)
  for (let i = 0; i < boxes; i += 1) {
    if (rand() < 0.6) {
      parts.push(ascii('ispe'))
      parts.push(noise(rand, 12))
    } else {
      parts.push(noise(rand, upto(rand, 24)))
    }
  }
  return concat(parts)
}

function webpBytes(rand: Rand): Uint8Array {
  const chunk = pick(rand, ['VP8 ', 'VP8L', 'VP8X', 'VP8?'])
  return concat([
    ascii('RIFF'),
    noise(rand, 4),
    ascii('WEBP'),
    ascii(chunk),
    noise(rand, upto(rand, 30)),
  ])
}

function imageBytes(rand: Rand): Uint8Array {
  const family = upto(rand, 7)
  let bytes: Uint8Array
  if (family === 0) {
    bytes = concat([PNG_SIGNATURE, noise(rand, 8 + upto(rand, 24))])
  } else if (family === 1) {
    bytes = concat([ascii(pick(rand, ['GIF87a', 'GIF89a', 'GIF8'])), noise(rand, upto(rand, 20))])
  } else if (family === 2) {
    bytes = jpegBytes(rand)
  } else if (family === 3) {
    bytes = webpBytes(rand)
  } else if (family === 4) {
    bytes = isoBytes(rand)
  } else if (family === 5) {
    bytes = ascii(svgText(rand))
  } else {
    bytes = noise(rand, upto(rand, 64))
  }

  // 途中で切れたファイル（読み出しが足りない、壊れている）を混ぜます。
  // 範囲外の読み出しはここで出ます。
  if (rand() < 0.3) bytes = bytes.subarray(0, upto(rand, bytes.length + 1))
  return bytes
}

// ===== SVG =====

const SVG_NUMBERS = ['10', '0', '-4', '1.5', '.5', '+3', '1e3', '00012', '1.', '999999999999999']
const SVG_UNITS = ['', 'px', 'pt', 'pc', 'in', 'mm', 'cm', 'q', 'Q', '%', 'em', 'PX', 'zz', ' px']

function svgLengthText(rand: Rand): string {
  if (rand() < 0.002) {
    // measure-images.ts が読む 64KB いっぱいの値。走査が二乗になっていれば、
    // 属性ひとつでプレビューが数秒止まります。
    return '1'.repeat(40_000 + upto(rand, 24_000)) + pick(rand, ['', '!', 'px', 'zz', '.'])
  }
  if (rand() < 0.1) {
    // 桁だけが長い値。
    return '1'.repeat(200 + upto(rand, 3000)) + pick(rand, ['', '!', 'px', 'zz', '.'])
  }
  return pick(rand, SVG_NUMBERS) + pick(rand, SVG_UNITS)
}

function svgText(rand: Rand): string {
  const attributes: string[] = []
  if (rand() < 0.8) attributes.push(` width="${svgLengthText(rand)}"`)
  if (rand() < 0.8) attributes.push(` height="${svgLengthText(rand)}"`)
  if (rand() < 0.6) {
    const box = Array.from({ length: 2 + upto(rand, 4) }, () => pick(rand, SVG_NUMBERS))
    attributes.push(` viewBox="${box.join(pick(rand, [' ', ',', ', ', '  ']))}"`)
  }
  if (rand() < 0.3) attributes.push(` xmlns='http://www.w3.org/2000/svg'`)
  if (rand() < 0.2) attributes.push(' width')
  const lead = pick(rand, ['', '\n', '﻿', '  \t', '<?xml version="1.0"?>\n', '<!-- c -->'])
  const close = pick(rand, ['>', '/>', '', ' '])
  return `${lead}<svg${attributes.join('')}${close}</svg>`
}

// ===== 原稿 =====

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
  '![図](fig.png)',
  '![a',
  '](img.png)',
  '!',
  '</p>',
  '<blockquote>',
  '|',
  '\\|',
  'text ',
  '漢字かな交じりの本文をそこそこの長さで',
  '[![i](i.png)](https://example.com)',
  'class=',
]
const PREFIX = ['', '# ', '## ', '### ', '> ', '> > ', '- ', '1. ', '```', '---', '| ', '  ', '\t']
const LINE_ENDING = ['\n', '\n', '\n', '\n\n', '\r\n', '\r']

function manuscript(rand: Rand, maxLines: number): string {
  const lines: string[] = []
  const count = 1 + upto(rand, maxLines)
  for (let l = 0; l < count; l += 1) {
    let line = pick(rand, PREFIX)
    const parts = upto(rand, 8)
    for (let p = 0; p < parts; p += 1) line += pick(rand, INLINE)
    if (rand() < 0.25) line += '  '
    lines.push(line)
  }
  let source = ''
  for (let l = 0; l < lines.length; l += 1) {
    source += lines[l] ?? ''
    if (l < lines.length - 1) source += pick(rand, LINE_ENDING)
  }
  return source
}

/** 原稿を少し書き換える。差分ビューはこの「前と後」を比べます。 */
function edited(rand: Rand, source: string): string {
  const segments = splitSegments(normalizeMarkdown(source))
  const edits = 1 + upto(rand, 3)
  for (let i = 0; i < edits; i += 1) {
    const at = upto(rand, segments.length + 1)
    const what = upto(rand, 4)
    if (what === 0 && segments.length > 0) {
      segments.splice(Math.min(at, segments.length - 1), 1)
    } else if (what === 1) {
      segments.splice(at, 0, manuscript(rand, 3))
    } else if (what === 2 && segments.length > 0) {
      const index = Math.min(at, segments.length - 1)
      segments[index] = `${segments[index] ?? ''}${pick(rand, INLINE)}`
    } else if (segments.length > 1) {
      const from = upto(rand, segments.length)
      const [moved] = segments.splice(from, 1)
      segments.splice(upto(rand, segments.length + 1), 0, moved ?? '')
    }
  }
  return segments.join('\n\n')
}

// ===== HTML の見方 =====

/** タグを除いた地の文。空白の入れ方は頁分けで変わるので詰めて比べる。 */
function textOnly(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, '')
}

/** タグだけを順に並べたもの。要素が消えたり増えたりしていないか見る。 */
function tagStream(html: string): string {
  return (html.match(/<[^>]*>/g) ?? []).join('')
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

function tagNameOf(block: string): string {
  const found = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(block)
  return (found?.[1] ?? '').toLowerCase()
}

// ===== それぞれのファジング =====

function fuzzImage(failures: Failures, base: number, cases: number): void {
  for (let n = 0; n < cases; n += 1) {
    const seed = base + n
    const rand = mulberry32(seed * 2654435761)
    const bytes = imageBytes(rand)
    failures.guard('image', seed, () => {
      const started = performance.now()
      const size = imageSize(bytes)
      const elapsed = performance.now() - started
      failures.check(elapsed < SLOW_MS, 'image/slow', seed, () => `${elapsed.toFixed(0)}ms`)
      if (size === null) return
      failures.check(
        Number.isFinite(size.width) && Number.isFinite(size.height),
        'image/finite',
        seed,
        () => JSON.stringify(size),
      )
      failures.check(size.width > 0 && size.height > 0, 'image/positive', seed, () =>
        JSON.stringify(size),
      )
    })
  }
}

function fuzzSvg(failures: Failures, base: number, cases: number): void {
  const encoder = new TextEncoder()
  for (let n = 0; n < cases; n += 1) {
    const seed = base + n
    const rand = mulberry32(seed * 40503 + 7)
    const text = svgText(rand)
    failures.guard('svg', seed, () => {
      const started = performance.now()
      const size = imageSize(encoder.encode(text))
      const elapsed = performance.now() - started
      failures.check(
        elapsed < SLOW_MS,
        'svg/slow',
        seed,
        () => `${elapsed.toFixed(0)}ms / ${text.slice(0, 120)}`,
      )
      if (size === null) return
      failures.check(
        Number.isFinite(size.width) &&
          size.width > 0 &&
          Number.isFinite(size.height) &&
          size.height > 0,
        'svg/size',
        seed,
        () => `${JSON.stringify(size)} / ${text.slice(0, 120)}`,
      )
    })
  }
}

const HEADINGS = new Set(['h1', 'h2', 'h3'])

// 実際の 2 つの頁と、ブロックごとに切れるだけの小さな頁。
const LAYOUTS: PageLayout[] = [
  PRINT_LAYOUT,
  MAGAZINE_LAYOUT,
  { ...MAGAZINE_LAYOUT, lines: 2, columns: 1 },
]

/** 断片の `<img>` に、measure-images.ts が入れるのと同じ形で寸法を足す。 */
function withSizes(rand: Rand, fragment: string): string {
  return fragment.replace(/<img\b[^>]*>/g, (tag) => {
    if (rand() < 0.25) return tag
    const width = pick(rand, [1, 16, 320, 1200, 4000, 100000])
    const height = pick(rand, [1, 9, 240, 900, 3000, 100000])
    return `${tag.slice(0, -1)} width="${width}" height="${height}">`
  })
}

function fuzzTypeset(failures: Failures, base: number, cases: number): void {
  for (let n = 0; n < cases; n += 1) {
    const seed = base + n
    const rand = mulberry32(seed * 2246822519 + 11)
    const source = manuscript(rand, 40)
    failures.guard('typeset', seed, () => {
      resetRenderCache()
      const fragment = withSizes(rand, renderMarkdown(source))
      const blocks = splitBlocks(fragment)
      for (const layout of LAYOUTS) {
        const started = performance.now()
        const pages = paginate(fragment, layout)
        const elapsed = performance.now() - started
        failures.check(elapsed < SLOW_MS, 'typeset/slow', seed, () => `${elapsed.toFixed(0)}ms`)

        const joined = pages.join('\n')
        failures.check(pages.length > 0, 'typeset/empty', seed, () => 'no pages')
        failures.check(textOnly(joined) === textOnly(fragment), 'typeset/text', seed, () =>
          JSON.stringify(source.slice(0, 200)),
        )
        failures.check(tagStream(joined) === tagStream(fragment), 'typeset/tags', seed, () =>
          JSON.stringify(source.slice(0, 200)),
        )
        for (const page of pages) {
          failures.check(unbalanced(page).length === 0, 'typeset/unbalanced', seed, () =>
            JSON.stringify(page.slice(0, 200)),
          )
        }

        // 泣き別れの送り（v0.2.0-preview 以降）。最後の紙より前の紙は、
        // 見出しだけを残して終わらない。ブロック 1 つの紙は送り先が無い。
        for (let i = 0; i < pages.length - 1; i += 1) {
          const page = splitBlocks(pages[i] ?? '')
          const last = page.at(-1) ?? ''
          failures.check(
            page.length <= 1 || !HEADINGS.has(tagNameOf(last)),
            'typeset/trailing-heading',
            seed,
            () => `頁 ${i + 1}/${pages.length} が ${tagNameOf(last)} で終わる`,
          )
        }

        failures.check(
          pages.length <= Math.max(1, blocks.length),
          'typeset/pages',
          seed,
          () => `${pages.length} 頁 / ${blocks.length} ブロック`,
        )
      }
    })
  }
}

function fuzzSegment(failures: Failures, base: number, cases: number): void {
  for (let n = 0; n < cases; n += 1) {
    const seed = base + n
    const rand = mulberry32(seed * 1103515245 + 13)
    const source = manuscript(rand, 30)
    failures.guard('segment', seed, () => {
      const text = normalizeMarkdown(source)
      const segments = splitSegments(text)
      // 区画は原稿の中の重ならない範囲で、順に並び、字面を落とさない。
      let at = 0
      for (const segment of segments) {
        const found = text.indexOf(segment, at)
        failures.check(found >= at, 'segment/order', seed, () =>
          JSON.stringify(segment.slice(0, 80)),
        )
        if (found < at) break
        at = found + segment.length
        failures.check(
          !segment.includes('\n\n') || segment.includes('```'),
          'segment/blank-line',
          seed,
          () => JSON.stringify(segment.slice(0, 120)),
        )
      }
      failures.check(text.slice(at).trim().length === 0, 'segment/lost', seed, () =>
        JSON.stringify(text.slice(at, at + 120)),
      )

      // 区画ごとに変換してつないだものは、原稿全体の変換と同じ。
      // 差分ビューはこの一致に乗っています。
      resetRenderCache()
      const whole = splitBlocks(renderMarkdown(text))
      const byPiece = splitBlocks(
        segments.map((segment) => renderMarkdownPiece(segment)).join('\n'),
      )
      failures.check(whole.join('\n') === byPiece.join('\n'), 'segment/piecewise', seed, () =>
        JSON.stringify(source.slice(0, 200)),
      )
    })
  }
}

/** 食い違った最初のブロックだけを見せる。 */
function firstDifference(got: readonly string[], want: readonly string[]): string {
  for (let i = 0; i < Math.max(got.length, want.length); i += 1) {
    if (got[i] === want[i]) continue
    return ` #${i} got ${JSON.stringify(got[i] ?? null)}\n #${i} want ${JSON.stringify(want[i] ?? null)}`
  }
  return ' (同じ)'
}

/** 同じ形の区画を 2 万個並べた原稿。 */
function manySegments(word: string): string {
  return Array.from({ length: 20_000 }, (_, i) => `${word}${i}`).join('\n\n')
}

const ADDED = ' class="diff-added"'
const REMOVED = ' class="diff-removed"'

function fuzzDiff(failures: Failures, base: number, cases: number): void {
  for (let n = 0; n < cases; n += 1) {
    const seed = base + n
    const rand = mulberry32(seed * 2654435761 + 17)
    const before = manuscript(rand, 24)
    const after = rand() < 0.15 ? before : edited(rand, before)
    failures.guard('diff', seed, () => {
      const oldText = normalizeMarkdown(before)
      const newText = normalizeMarkdown(after)

      const started = performance.now()
      const html = renderBlockDiff(oldText, newText, renderMarkdownPiece)
      const elapsed = performance.now() - started
      failures.check(elapsed < SLOW_MS, 'diff/slow', seed, () => `${elapsed.toFixed(0)}ms`)

      failures.check(unbalanced(html).length === 0, 'diff/unbalanced', seed, () =>
        JSON.stringify(html.slice(0, 200)),
      )

      const blocks = splitBlocks(html)
      const kept = (marker: string, other: string): string[] =>
        blocks.filter((block) => !block.includes(other)).map((block) => block.replace(marker, ''))

      resetRenderCache()
      const newBlocks = splitBlocks(renderMarkdown(newText))
      resetRenderCache()
      const oldBlocks = splitBlocks(renderMarkdown(oldText))

      failures.check(
        kept(ADDED, REMOVED).join('\n') === newBlocks.join('\n'),
        'diff/new',
        seed,
        () => `${JSON.stringify(after)}\n${firstDifference(kept(ADDED, REMOVED), newBlocks)}`,
      )
      failures.check(
        kept(REMOVED, ADDED).join('\n') === oldBlocks.join('\n'),
        'diff/old',
        seed,
        () => `${JSON.stringify(before)}\n${firstDifference(kept(REMOVED, ADDED), oldBlocks)}`,
      )

      if (before === after) {
        failures.check(!html.includes(ADDED) && !html.includes(REMOVED), 'diff/noop', seed, () =>
          JSON.stringify(html.slice(0, 200)),
        )
      }

      // 区画の多い原稿。区画数の積の表を組んでいれば、ここで場所か時間が尽きます。
      if (n % 5000 === 0) {
        const at = performance.now()
        renderBlockDiff(manySegments('段落'), manySegments('別の段落'), renderMarkdownPiece)
        const took = performance.now() - at
        failures.check(
          took < 3000,
          'diff/scale',
          seed,
          () => `区画 2 万どうしの差分に ${took.toFixed(0)}ms`,
        )
      }

      // LCS そのもの。keep は両側に同じ順で現れる。
      const ops = diffSegments(splitSegments(oldText), splitSegments(newText))
      const keeps = ops.filter((op) => op.kind === 'keep').length
      failures.check(
        ops.filter((op) => op.kind !== 'add').length ===
          splitSegments(oldText).filter((segment) => !/^\s*$/.test(segment)).length,
        'diff/lcs-old',
        seed,
        () => `keep+del ${ops.length} / keep ${keeps}`,
      )
      failures.check(
        ops.filter((op) => op.kind !== 'del').length ===
          splitSegments(newText).filter((segment) => !/^\s*$/.test(segment)).length,
        'diff/lcs-new',
        seed,
        () => `keep+add ${ops.length} / keep ${keeps}`,
      )
    })
  }
}

const MODES: PreviewMode[] = ['print', 'magazine', 'web']

function fuzzDocument(failures: Failures, base: number, cases: number): void {
  for (let n = 0; n < cases; n += 1) {
    const seed = base + n
    const rand = mulberry32(seed * 40503 + 19)
    const source = manuscript(rand, 30)
    const diff = rand() < 0.5
    failures.guard('document', seed, () => {
      resetRenderCache()
      let fragment = withSizes(rand, renderMarkdown(source))
      if (diff) {
        fragment = renderBlockDiff(
          normalizeMarkdown(source),
          normalizeMarkdown(edited(rand, source)),
          renderMarkdownPiece,
        )
      }
      for (const mode of MODES) {
        const html = renderDocument(fragment, {
          mode,
          liveReload: 'abc',
          diffLink: true,
          diffActive: diff,
        })
        failures.check(
          unbalanced(html).length === 0,
          'document/unbalanced',
          seed,
          () => `${mode}: ${JSON.stringify(source.slice(0, 160))}`,
        )
        if (mode === 'web') continue

        // ノンブルは 1 から順に、抜けなく並ぶ。
        const numbers = [...html.matchAll(/data-page="(\d+)"/g)].map((m) => Number(m[1]))
        failures.check(
          numbers.every((value, index) => value === index + 1),
          'document/page-numbers',
          seed,
          () => numbers.slice(0, 12).join(','),
        )
        // 柱は属性の中身。引用符や山括弧が生では出ない。
        for (const match of html.matchAll(/data-head="([^"]*)"/g)) {
          const head = match[1] ?? ''
          failures.check(
            !head.includes('<') && !head.includes('>'),
            'document/running-head',
            seed,
            () => JSON.stringify(head.slice(0, 120)),
          )
        }
        // 柱は 1 枚目には出さない。
        const first = html.indexOf('data-page="1"')
        const second = html.indexOf('data-page="2"')
        const firstPaper = html.slice(first, second === -1 ? first + 40 : second)
        failures.check(!firstPaper.includes('data-head='), 'document/first-head', seed, () =>
          JSON.stringify(firstPaper.slice(0, 120)),
        )
      }
    })
  }
}

async function fuzzMeasure(failures: Failures, base: number, cases: number): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'kumihan-fuzz-measure-'))
  try {
    for (let n = 0; n < cases; n += 1) {
      const seed = base + n
      const rand = mulberry32(seed * 2246822519 + 23)
      const name = `fig${upto(rand, 4)}.${pick(rand, ['png', 'jpg', 'gif', 'webp', 'svg', 'avif'])}`
      await writeFile(join(root, name), imageBytes(rand))
      const fragment = renderMarkdown(`![図](${name})\n\n本文\n`)
      try {
        const started = performance.now()
        const sized = await withImageSizes(fragment, root)
        const elapsed = performance.now() - started
        failures.check(elapsed < SLOW_MS * 4, 'measure/slow', seed, () => `${elapsed.toFixed(0)}ms`)
        failures.check(textOnly(sized) === textOnly(fragment), 'measure/text', seed, () =>
          JSON.stringify(sized.slice(0, 200)),
        )
        for (const tag of sized.matchAll(/<img\b[^>]*>/g)) {
          const width = /\swidth="([^"]*)"/.exec(tag[0])?.[1]
          const height = /\sheight="([^"]*)"/.exec(tag[0])?.[1]
          if (width === undefined && height === undefined) continue
          failures.check(
            /^\d+$/.test(width ?? '') && /^\d+$/.test(height ?? ''),
            'measure/attribute',
            seed,
            () => tag[0].slice(0, 160),
          )
          failures.check(
            tag[0].endsWith('">') && !tag[0].includes('/ width'),
            'measure/tag',
            seed,
            () => tag[0].slice(0, 160),
          )
        }
        // 頁分けはこの寸法を読むので、そのまま通す。
        paginate(sized, MAGAZINE_LAYOUT)
      } catch (error) {
        failures.check(false, 'measure/throw', seed, () => String(error).slice(0, 300))
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function fuzzHttp(failures: Failures, base: number, cases: number): Promise<void> {
  const { execFile } = process.getBuiltinModule('node:child_process')
  const run = (cwd: string, args: string[]): Promise<void> =>
    new Promise((settle, fail) => {
      execFile('git', args, { cwd }, (error) => (error ? fail(error) : settle()))
    })

  const root = await mkdtemp(join(tmpdir(), 'kumihan-fuzz-http-'))
  const source = join(root, 'index.md')
  try {
    await run(root, ['init', '-q'])
    await run(root, ['config', 'user.email', 'fuzz@example.com'])
    await run(root, ['config', 'user.name', 'fuzz'])
    await writeFile(source, '# 見出し\n\n本文\n')
    await run(root, ['add', 'index.md'])
    await run(root, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'init'])

    const app = createPreviewApp({ source })
    const paths = ['/', '/magazine', '/web', '/diff', '/magazine-diff', '/web-diff']
    for (let n = 0; n < cases; n += 1) {
      const seed = base + n
      const rand = mulberry32(seed * 1103515245 + 29)
      await writeFile(source, manuscript(rand, 20))
      for (const path of paths) {
        const response = await app.request(`http://127.0.0.1${path}`)
        const body = await response.text()
        failures.check(
          response.status === 200,
          'http/status',
          seed,
          () => `${path}: ${response.status}`,
        )
        failures.check(
          !body.includes('at Object.') && !body.includes('node:internal'),
          'http/stack',
          seed,
          () => `${path}: ${body.slice(0, 200)}`,
        )
        failures.check(
          unbalanced(body).length === 0,
          'http/unbalanced',
          seed,
          () => `${path}: ${unbalanced(body).join(',')}`,
        )
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// ===== 走らせる =====

interface Category {
  readonly name: string
  /** 100 万件を配るときの取り分。 */
  readonly share: number
  readonly run: (failures: Failures, base: number, cases: number) => void | Promise<void>
}

const CATEGORIES: Category[] = [
  { name: 'image', share: 0.34, run: fuzzImage },
  { name: 'svg', share: 0.16, run: fuzzSvg },
  { name: 'typeset', share: 0.16, run: fuzzTypeset },
  { name: 'segment', share: 0.13, run: fuzzSegment },
  { name: 'diff', share: 0.13, run: fuzzDiff },
  { name: 'document', share: 0.07, run: fuzzDocument },
  { name: 'measure', share: 0.005, run: fuzzMeasure },
  { name: 'http', share: 0.005, run: fuzzHttp },
]

const { values } = parseArgs({
  options: {
    cases: { type: 'string', default: '1000000' },
    seed: { type: 'string', default: '1' },
    only: { type: 'string' },
  },
  allowPositionals: false,
})

const total = Number(values.cases)
if (!Number.isFinite(total) || total <= 0) {
  console.error('--cases must be a positive number')
  process.exit(2)
}
const seedBase = Number(values.seed)
const wanted = values.only?.split(',').map((name) => name.trim())
const chosen = wanted === undefined ? CATEGORIES : CATEGORIES.filter((c) => wanted.includes(c.name))
if (chosen.length === 0) {
  console.error(`--only must name one of: ${CATEGORIES.map((c) => c.name).join(', ')}`)
  process.exit(2)
}

const weight = chosen.reduce((sum, category) => sum + category.share, 0)
const failures = new Failures()
let ran = 0
const startedAll = performance.now()

for (const category of chosen) {
  const cases = Math.max(1, Math.round((total * category.share) / weight))
  const started = performance.now()
  await category.run(failures, seedBase, cases)
  ran += cases
  const elapsed = (performance.now() - started) / 1000
  console.log(
    `${category.name.padEnd(9)} ${String(cases).padStart(8)} 件  ${elapsed.toFixed(1)}s  ` +
      `(${Math.round(cases / Math.max(elapsed, 0.001))} 件/s)`,
  )
}

console.log(`\n合計 ${ran} 件 / ${((performance.now() - startedAll) / 1000).toFixed(1)}s`)

if (failures.found.length === 0) {
  console.log('見つかった不具合はありません。')
} else {
  const kinds = new Map<string, number>()
  for (const failure of failures.found) kinds.set(failure.kind, (kinds.get(failure.kind) ?? 0) + 1)
  console.log(`\n見つかった不具合 ${failures.found.length} 件（最大 40 件まで記録）:`)
  for (const [kind, count] of kinds) console.log(`  ${kind}: ${count}`)
  console.log('')
  for (const failure of failures.found.slice(0, 20)) {
    console.log(`- [${failure.kind}] seed ${failure.seed}\n  ${failure.detail}`)
  }
  process.exit(1)
}

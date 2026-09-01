import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { diffSegments, renderBlockDiff } from '../src/diff/block-diff.js'
import {
  normalizeMarkdown,
  renderMarkdown,
  renderMarkdownPiece,
  resetRenderCache,
} from '../src/markdown/render.js'
import { splitSegments } from '../src/markdown/segments.js'
import { splitBlocks } from '../src/typesetting/paginate.js'

// v0.2.0-preview のあとに入った区画差分（#51 / #54）を機械的に揺さぶります。
// 差分ビューは同じ原稿を通常プレビューとは別の道（区画ごとの変換）で組むので、
// 「印を外せば元に戻る」が成り立たなければいけません。すなわち、diff-removed を
// 落として diff-added の印を外したものは今の原稿の組み上がりそのもので、
// diff-added を落として diff-removed の印を外したものは HEAD の原稿そのものです。
//
// 桁を上げた走らせ方は `bun run fuzz`（scripts/fuzz.ts）です。種は固定です。

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
  '![図](fig.png)',
  '](img.png)',
  '</p>',
  '|',
  '\\|',
  'text ',
  '漢字かな交じりの本文をそこそこの長さで',
]
const PREFIX = ['', '# ', '## ', '### ', '> ', '> > ', '- ', '1. ', '```', '---', '| ', '  ', '\t']
const LINE_ENDING = ['\n', '\n', '\n', '\n\n', '\r\n', '\r']

function generate(rand: () => number, maxLines: number): string {
  const lines: string[] = []
  const count = 1 + Math.floor(rand() * maxLines)
  for (let l = 0; l < count; l += 1) {
    let line = PREFIX[Math.floor(rand() * PREFIX.length)] ?? ''
    const parts = Math.floor(rand() * 8)
    for (let p = 0; p < parts; p += 1) line += INLINE[Math.floor(rand() * INLINE.length)] ?? ''
    if (rand() < 0.25) line += '  '
    lines.push(line)
  }
  let source = ''
  for (let l = 0; l < lines.length; l += 1) {
    source += lines[l] ?? ''
    if (l < lines.length - 1) source += LINE_ENDING[Math.floor(rand() * LINE_ENDING.length)] ?? '\n'
  }
  return source
}

/** 原稿を区画の単位で少し書き換える。差分ビューはこの前後を比べる。 */
function edit(rand: () => number, source: string): string {
  const segments = splitSegments(normalizeMarkdown(source))
  const edits = 1 + Math.floor(rand() * 3)
  for (let i = 0; i < edits; i += 1) {
    const at = Math.floor(rand() * (segments.length + 1))
    const what = Math.floor(rand() * 3)
    if (what === 0 && segments.length > 0) {
      segments.splice(Math.min(at, segments.length - 1), 1)
    } else if (what === 1) {
      segments.splice(at, 0, generate(rand, 3))
    } else if (segments.length > 0) {
      const index = Math.min(at, segments.length - 1)
      segments[index] = `${segments[index] ?? ''}あ`
    }
  }
  return segments.join('\n\n')
}

function hasContent(segment: string): boolean {
  return !/^\s*$/.test(segment)
}

const ADDED = ' class="diff-added"'
const REMOVED = ' class="diff-removed"'

/** 片側の印だけを外し、もう一方の印が付いたブロックを落とす。 */
function without(blocks: readonly string[], marker: string, other: string): string {
  return blocks
    .filter((block) => !block.includes(other))
    .map((block) => block.replace(marker, ''))
    .join('\n')
}

function blocksOf(markdown: string): string {
  resetRenderCache()
  return splitBlocks(renderMarkdown(markdown)).join('\n')
}

describe('block diff fuzzing', () => {
  it('shows both manuscripts under the diff marks', () => {
    for (let seed = 1; seed <= 3000; seed += 1) {
      const rand = mulberry32(seed * 2654435761)
      const before = generate(rand, 24)
      const after = rand() < 0.15 ? before : edit(rand, before)
      const oldText = normalizeMarkdown(before)
      const newText = normalizeMarkdown(after)
      const context = `seed ${seed} / 入力 ${JSON.stringify(before.slice(0, 160))}`

      const blocks = splitBlocks(renderBlockDiff(oldText, newText, renderMarkdownPiece))
      assert.equal(
        without(blocks, ADDED, REMOVED),
        blocksOf(newText),
        `いまの原稿が戻らない。${context}`,
      )
      assert.equal(
        without(blocks, REMOVED, ADDED),
        blocksOf(oldText),
        `HEAD の原稿が戻らない。${context}`,
      )
      if (before === after) {
        assert.equal(blocks.join('\n').includes('diff-'), false, `印が付いた。${context}`)
      }
    }
  })

  it('lines every op up with the segment it came from', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const rand = mulberry32(seed * 40503)
      const before = generate(rand, 20)
      const after = edit(rand, before)
      const context = `seed ${seed}`

      const older = splitSegments(normalizeMarkdown(before)).filter(hasContent)
      const newer = splitSegments(normalizeMarkdown(after)).filter(hasContent)
      const ops = diffSegments(older, newer)

      assert.deepEqual(
        ops.filter((op) => op.kind !== 'add').map((op) => op.text),
        older,
        `keep と del が HEAD の区画に並ばない。${context}`,
      )
      assert.deepEqual(
        ops.filter((op) => op.kind !== 'del').map((op) => op.text),
        newer,
        `keep と add がいまの区画に並ばない。${context}`,
      )
    }
  })

  it('splits a manuscript into segments that render like the whole', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const text = normalizeMarkdown(generate(mulberry32(seed * 1103515245), 30))
      const context = `seed ${seed}`
      const segments = splitSegments(text)

      // 区画は原稿の中の重ならない範囲で、順に並び、字面を落とさない。
      let at = 0
      for (const segment of segments) {
        const found = text.indexOf(segment, at)
        assert.ok(found >= at, `区画が原稿の順に並ばない。${context}`)
        at = found + segment.length
        // 区切りはフェンス外の空行だけ。
        assert.ok(
          !segment.includes('\n\n') || segment.includes('```'),
          `空行をまたいだ区画。${context}`,
        )
      }
      assert.equal(text.slice(at).trim(), '', `区画から漏れた本文がある。${context}`)

      resetRenderCache()
      const whole = splitBlocks(renderMarkdown(text)).join('\n')
      const piecewise = splitBlocks(
        segments.map((segment) => renderMarkdownPiece(segment)).join('\n'),
      ).join('\n')
      assert.equal(piecewise, whole, `区画ごとの変換が全体と食い違う。${context}`)
    }
  })
})

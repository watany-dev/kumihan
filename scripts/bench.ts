/**
 * 組版パイプラインのマイクロベンチマーク。
 *
 *   bun scripts/bench.ts [--iterations N] [--scale N]
 *
 * `content/index.md` を scale 倍に増幅した原稿を使い、Markdown → HTML の
 * 変換にかかる時間を段階ごとに計測します。
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { escapeHtml, sanitizeUrl } from '../src/markdown/escape.js'
import { renderInline } from '../src/markdown/inline.js'
import { renderMarkdown } from '../src/markdown/render.js'
import { renderDocument } from '../src/typesetting/render-page.js'

const { values } = parseArgs({
  options: {
    iterations: { type: 'string', default: '50' },
    scale: { type: 'string', default: '40' },
  },
})

const iterations = Number(values.iterations)
const scale = Number(values.scale)

const base = readFileSync('./content/index.md', 'utf8')
const manuscript = Array.from({ length: scale }, () => base).join('\n\n')
const prose = 'The quick brown fox jumps over the lazy dog. '.repeat(200)
const inlineRich = '**強調**と*斜体*と`code`と[リンク](https://example.com)。'.repeat(200)
const plainInline = '組版された日本語の本文がひたすら続くだけの一行です。'.repeat(200)

interface Case {
  name: string
  bytes: number
  run: () => unknown
}

const cases: Case[] = [
  { name: 'escapeHtml (plain)', bytes: prose.length, run: () => escapeHtml(prose) },
  {
    name: 'escapeHtml (markup)',
    bytes: prose.length,
    run: () => escapeHtml(`<p>${prose}</p> & "quoted"`),
  },
  { name: 'sanitizeUrl', bytes: 0, run: () => sanitizeUrl('https://example.com/path?a=1') },
  { name: 'renderInline (plain)', bytes: plainInline.length, run: () => renderInline(plainInline) },
  { name: 'renderInline (rich)', bytes: inlineRich.length, run: () => renderInline(inlineRich) },
  { name: 'renderMarkdown', bytes: manuscript.length, run: () => renderMarkdown(manuscript) },
  {
    name: 'renderDocument (full)',
    bytes: manuscript.length,
    run: () => renderDocument(renderMarkdown(manuscript), { mode: 'web' }),
  },
]

function measure(run: () => unknown, count: number): number[] {
  const samples: number[] = []
  for (let i = 0; i < count; i += 1) {
    const started = performance.now()
    run()
    samples.push(performance.now() - started)
  }
  return samples
}

function median(samples: number[]): number {
  // 挿入ソートで昇順の複製を作る（サンプル数は数百なので十分速い）。
  const sorted: number[] = []
  for (const sample of samples) {
    let index = sorted.length
    while (index > 0 && (sorted[index - 1] ?? 0) > sample) {
      sorted[index] = sorted[index - 1] ?? 0
      index -= 1
    }
    sorted[index] = sample
  }

  const mid = sorted.length >> 1
  const upper = sorted[mid] ?? 0
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + upper) / 2 : upper
}

console.log(`iterations=${iterations} scale=${scale} manuscript=${manuscript.length}B\n`)
console.log('case                        median(ms)     min(ms)     MB/s')
console.log('-'.repeat(62))

for (const testCase of cases) {
  measure(testCase.run, Math.max(3, Math.ceil(iterations / 5))) // warmup
  const samples = measure(testCase.run, iterations)
  const med = median(samples)
  const min = Math.min(...samples)
  const throughput = testCase.bytes === 0 ? '-' : (testCase.bytes / 1e6 / (med / 1000)).toFixed(1)
  console.log(
    `${testCase.name.padEnd(26)} ${med.toFixed(3).padStart(10)} ${min.toFixed(3).padStart(11)} ${throughput.padStart(8)}`,
  )
}

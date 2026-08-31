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

import { exportSite } from '../src/export/export-site.js'
import { escapeHtml, sanitizeUrl } from '../src/markdown/escape.js'
import { renderInline } from '../src/markdown/inline.js'
import { renderMarkdown, resetRenderCache } from '../src/markdown/render.js'
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
const fragment = renderMarkdown(manuscript)

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
  {
    name: 'renderMarkdown (cold)',
    bytes: manuscript.length,
    run: () => {
      // 増分キャッシュを忘れさせ、初回変換（原稿全体の変換）を測る。
      resetRenderCache()
      return renderMarkdown(manuscript)
    },
  },
  {
    name: 'renderMarkdown (reload)',
    bytes: manuscript.length,
    // 同じ原稿の変換し直し（別タブやモード切り替えが取りに来る経路）。
    run: () => renderMarkdown(manuscript),
  },
  {
    name: 'renderMarkdown (1 edit)',
    bytes: manuscript.length,
    // 保存のたびの変換し直し。原稿の真ん中に毎回違う段落を 1 つ差し込み、
    // 「1 ブロックだけ変わった原稿」を作ってから変換する。
    run: (() => {
      const mid = manuscript.indexOf('\n\n', manuscript.length >> 1) + 2
      const head = manuscript.slice(0, mid)
      const tail = manuscript.slice(mid)
      let edit = 0
      return () => {
        edit += 1
        return renderMarkdown(`${head}編集された段落 ${edit}。\n\n${tail}`)
      }
    })(),
  },
  // 組版と 2段は頁分け（paginate）を通ります。Web だけを測っていたころは、
  // 既定の `/` が通る経路がベンチにまったく出てこず、そこにあった二乗時間に
  // 気づけませんでした。断片は測る前に作っておき、頁分けだけを見ます。
  {
    name: 'renderDocument (web)',
    bytes: manuscript.length,
    run: () => renderDocument(fragment, { mode: 'web' }),
  },
  {
    name: 'renderDocument (print)',
    bytes: manuscript.length,
    run: () => renderDocument(fragment, { mode: 'print' }),
  },
  {
    name: 'renderDocument (magazine)',
    bytes: manuscript.length,
    run: () => renderDocument(fragment, { mode: 'magazine' }),
  },
  {
    name: 'markdown + print',
    bytes: manuscript.length,
    run: () => renderDocument(renderMarkdown(manuscript), { mode: 'print' }),
  },
  // 書き出しの変換部分をまとめて測ります（ファイル書き込みは含みません）。
  // 3 つのモードを 1 つの断片から組むので、変換 1 回 + 文書 3 つぶんに
  // なっているか（変換が二重に走っていないか）をここで見張ります。
  {
    name: 'exportSite (3 modes)',
    bytes: manuscript.length,
    run: () => exportSite(manuscript),
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
  // JIT が温まりきる前の計測は桁で外れます（`escapeHtml (markup)` は暖機が
  // 足りないと実測の 1/30 のスループットに見えました）。反復数が少なくても
  // 一定回数は空回ししてから測ります。
  measure(testCase.run, Math.max(200, Math.ceil(iterations / 5))) // warmup
  const samples = measure(testCase.run, iterations)
  const med = median(samples)
  const min = Math.min(...samples)
  const throughput = testCase.bytes === 0 ? '-' : (testCase.bytes / 1e6 / (med / 1000)).toFixed(1)
  console.log(
    `${testCase.name.padEnd(26)} ${med.toFixed(3).padStart(10)} ${min.toFixed(3).padStart(11)} ${throughput.padStart(8)}`,
  )
}

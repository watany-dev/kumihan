/**
 * 組版パイプラインのメモリ・ベンチマーク。
 *
 *   bun scripts/memory.ts [--scale N] [--json]
 *
 * `content/index.md` を scale 倍に増幅した原稿を段階ごとに変換し、
 * 各段階の RSS ピークと保持ヒープを測ります。RSS は別スレッドから
 * 1ms 間隔で採取するので、同期処理の途中の山も拾えます。
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { Worker } from 'node:worker_threads'

import { exportFiles } from '../src/export/export-site.js'
import { renderMarkdown } from '../src/markdown/render.js'
import { renderDocument } from '../src/typesetting/render-page.js'

const { values } = parseArgs({
  options: {
    scale: { type: 'string', default: '400' },
    json: { type: 'boolean', default: false },
  },
})

const scale = Number(values.scale)
const base = readFileSync('./content/index.md', 'utf8')
const manuscript = Array.from({ length: scale }, () => base).join('\n\n')
const inputBytes = Buffer.byteLength(manuscript)

interface Stage {
  name: string
  run: () => unknown
}

// 各段階は前段の出力を入力に取るので、直前の結果を持ち回ります。
let fragment = ''
let document = ''

const stages: Stage[] = [
  { name: 'renderMarkdown', run: () => (fragment = renderMarkdown(manuscript)) },
  { name: 'renderDocument', run: () => (document = renderDocument(fragment, { mode: 'web' })) },
  { name: 'exportFiles (3 modes)', run: () => exportFiles(fragment) },
  {
    name: 'writeExport (bytes)',
    run: () => exportFiles(fragment).map((file) => file.body),
  },
]

interface Result {
  name: string
  peakRss: number
  rssDelta: number
  retainedHeap: number
}

const sampler = await startSampler()
const results: Result[] = []

for (const stage of stages) {
  await collectGarbage()
  const beforeRss = process.memoryUsage.rss()
  const beforeHeap = process.memoryUsage().heapUsed

  sampler.reset(beforeRss)
  await stage.run()
  const peakRss = sampler.peak()

  const afterHeap = process.memoryUsage().heapUsed
  results.push({
    name: stage.name,
    peakRss,
    rssDelta: peakRss - beforeRss,
    retainedHeap: afterHeap - beforeHeap,
  })
}

await sampler.stop()

if (values.json) {
  console.log(
    JSON.stringify(
      {
        scale,
        inputBytes,
        fragmentBytes: fragment.length,
        documentBytes: document.length,
        results,
      },
      undefined,
      2,
    ),
  )
} else {
  console.log(
    `scale=${scale} manuscript=${kib(inputBytes)} fragment=${kib(Buffer.byteLength(fragment))} document=${kib(Buffer.byteLength(document))}\n`,
  )
  console.log('stage                     peak RSS   ΔRSS   Δheap   Δ/入力')
  console.log('-'.repeat(64))
  for (const result of results) {
    const ratio = (result.rssDelta / inputBytes).toFixed(1)
    console.log(
      `${result.name.padEnd(22)} ${kib(result.peakRss).padStart(10)} ${kib(result.rssDelta).padStart(9)} ${kib(result.retainedHeap).padStart(9)} ${`${ratio}x`.padStart(7)}`,
    )
  }
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)}K`
}

/**
 * 同期処理の最中でも RSS を採れるよう、別スレッドで 1ms ごとに
 * `process.memoryUsage.rss()`（プロセス全体の値）を読み続けます。
 */
async function startSampler(): Promise<{
  reset: (floor: number) => void
  peak: () => number
  stop: () => Promise<void>
}> {
  const shared = new SharedArrayBuffer(8)
  const view = new BigInt64Array(shared)
  const worker = new Worker(
    `const { workerData } = require('node:worker_threads')
     const view = new BigInt64Array(workerData)
     setInterval(() => {
       const rss = BigInt(process.memoryUsage.rss())
       if (rss > Atomics.load(view, 0)) Atomics.store(view, 0, rss)
     }, 1)`,
    { eval: true, workerData: shared },
  )
  worker.unref()

  return {
    reset: (floor: number) => Atomics.store(view, 0, BigInt(floor)),
    peak: () => Number(Atomics.load(view, 0)),
    stop: async () => {
      await worker.terminate()
    },
  }
}

async function collectGarbage(): Promise<void> {
  const runtime: {
    gc?: (() => void) | undefined
    Bun?: { gc: (sync: boolean) => void } | undefined
  } = globalThis
  // Bun は Bun.gc(true)、Node は --expose-gc の globalThis.gc で強制できます。
  runtime.Bun?.gc(true)
  runtime.gc?.()
  // GC を強制できない実行環境でも、次の段階の計測が前段の後始末を
  // 拾わないように 1 tick 空けます。
  await new Promise((resolve) => setTimeout(resolve, 20))
}

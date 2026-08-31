/**
 * 保存からプレビュー反映までのレイテンシ・ベンチマーク。
 *
 *   bun scripts/latency.ts [--trials N] [--scale N]
 *
 * 実際のプレビューサーバーを立て、原稿の保存を繰り返しながら、更新が
 * HTTP 越しに見えるまでの時間を測ります。ブラウザの挙動に合わせて
 * 2 通りを自動で使い分けます。
 *
 *   - 応答に `Refresh: N` が付くなら、その間隔で取り直すブラウザを模して、
 *     保存を間隔内のランダムな時点で行い、次の取得が新しい本文を返すまでを
 *     測ります（従来方式のベースライン）。
 *   - 付かないなら `/events` の通知を待ってから取得します（SSE 方式）。
 *
 * あわせて、原稿を変えずに 10 秒間放置したときの転送量も測ります。
 * ポーリングは変わらない原稿を運び続け、SSE はほぼ運びません。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { createPreviewApp } from '../src/app.js'
import { createNodeServer } from '../src/node-server.js'

const { values } = parseArgs({
  options: {
    trials: { type: 'string', default: '10' },
    scale: { type: 'string', default: '40' },
  },
})

const trials = Number(values.trials)
const scale = Number(values.scale)

const base = readFileSync('./content/index.md', 'utf8')
const body = Array.from({ length: scale }, () => base).join('\n\n')

const dir = mkdtempSync(join(tmpdir(), 'kumihan-latency-'))
const file = join(dir, 'index.md')
writeFileSync(file, body)

const server = createNodeServer(createPreviewApp({ source: file }))
const port = await new Promise<number>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    resolve(typeof address === 'object' && address !== null ? address.port : 0)
  })
})
const origin = `http://127.0.0.1:${port}`

try {
  const first = await fetch(`${origin}/`)
  const document = await first.text()
  const refresh = Number(first.headers.get('Refresh'))
  const mode = Number.isFinite(refresh) && refresh > 0 ? 'poll' : 'sse'

  console.log(
    `mode=${mode} trials=${trials} scale=${scale} ` +
      `manuscript=${kib(Buffer.byteLength(body))} document=${kib(Buffer.byteLength(document))}\n`,
  )

  const samples: number[] = []
  for (let i = 0; i < trials; i += 1) {
    const marker = `latency-marker-${i}-${Date.now()}`
    samples.push(
      mode === 'poll' ? await measurePoll(marker, refresh * 1000) : await measureNotify(marker),
    )
  }

  samples.sort((a, b) => a - b)
  const mid = samples.length >> 1
  const median =
    samples.length % 2 === 0
      ? ((samples[mid - 1] ?? 0) + (samples[mid] ?? 0)) / 2
      : (samples[mid] ?? 0)
  console.log('保存 → 更新済み HTML の取得完了（ブラウザの parse/layout は含まない）')
  console.log(
    `  median ${median.toFixed(1)}ms  min ${(samples[0] ?? 0).toFixed(1)}ms  max ${(samples.at(-1) ?? 0).toFixed(1)}ms`,
  )

  const idle = await measureIdleTraffic(mode, Number.isFinite(refresh) ? refresh * 1000 : 0)
  console.log(`\n無変更で 10 秒放置したときの転送量: ${kib(idle)} (${mode})`)
} finally {
  server.close()
  rmSync(dir, { recursive: true, force: true })
}

/**
 * `Refresh: N` に従うブラウザを模す。取得を間隔ごとに繰り返し、保存は
 * 間隔内のランダムな時点で行う。保存後、新しい本文を含む応答が返り
 * きるまでの時間がユーザーの見る遅れになる。
 */
async function measurePoll(marker: string, intervalMs: number): Promise<number> {
  const offset = Math.random() * intervalMs
  await sleep(offset)
  const saved = performance.now()
  writeFileSync(file, `${body}\n\n${marker}\n`)
  await sleep(intervalMs - offset)
  for (;;) {
    const res = await fetch(`${origin}/`)
    const html = await res.text()
    if (html.includes(marker)) return performance.now() - saved
    await sleep(intervalMs)
  }
}

/** `/events` の通知を待ち、通知が来てから更新済みの本文を取得する。 */
async function measureNotify(marker: string): Promise<number> {
  // reader.cancel() だけでは Bun の fetch が接続を残すので、abort で切る。
  const disconnect = new AbortController()
  const events = await fetch(`${origin}/events`, { signal: disconnect.signal })
  if (events.body === null) throw new Error('/events has no body')
  const reader = events.body.getReader()

  const saved = performance.now()
  writeFileSync(file, `${body}\n\n${marker}\n`)

  // SSE のイベント 1 件（空行区切り）を待つ。
  const decoder = new TextDecoder()
  let buffered = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) throw new Error('/events closed before notifying')
    buffered += decoder.decode(value, { stream: true })
    if (buffered.includes('data:')) break
  }
  disconnect.abort()

  const res = await fetch(`${origin}/`)
  const html = await res.text()
  if (!html.includes(marker)) throw new Error('notified but the document is stale')
  return performance.now() - saved
}

/** 原稿を変えないまま 10 秒間、ブラウザ相当の通信を流し、受信量を数える。 */
async function measureIdleTraffic(mode: string, intervalMs: number): Promise<number> {
  const deadline = performance.now() + 10_000
  let bytes = 0

  if (mode === 'poll') {
    while (performance.now() < deadline) {
      const res = await fetch(`${origin}/`)
      bytes += Buffer.byteLength(await res.text())
      await sleep(intervalMs)
    }
    return bytes
  }

  const disconnect = new AbortController()
  const events = await fetch(`${origin}/events`, { signal: disconnect.signal })
  if (events.body === null) return 0
  const reader = events.body.getReader()
  const timer = setTimeout(() => disconnect.abort(), 10_000)
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }))
    if (done || value === undefined) break
    bytes += value.byteLength
  }
  clearTimeout(timer)
  return bytes
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)}K`
}

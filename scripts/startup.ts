/**
 * 起動時間のベンチマーク。
 *
 *   bun scripts/startup.ts [--iterations N] [--json]
 *
 * `dist-bin/` のスタンドアロン実行ファイルを何度も起動し、プロセスが
 * 終わるまでの時間を測ります。組版そのものではなく、ランタイムと
 * モジュールの読み込みにかかる時間を見るためのものです。ここが伸びると、
 * 原稿の大きさに関係なく毎回の実行が遅くなります。
 *
 * 先に `bun run compile` でバイナリを作っておいてください。ソースから
 * `bun src/cli.ts` で測ると、その場のトランスパイルが混ざって桁が変わります。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    iterations: { type: 'string', default: '30' },
    json: { type: 'boolean', default: false },
  },
})

const iterations = Number(values.iterations)

const binary = join('dist-bin', process.platform === 'win32' ? 'kumihan.exe' : 'kumihan')
if (!existsSync(binary)) {
  console.error(`実行ファイルがありません: ${binary}`)
  console.error('先に `bun run compile` を実行してください。')
  process.exit(1)
}

const workDir = mkdtempSync(join(tmpdir(), 'kumihan-startup-'))

interface Case {
  name: string
  args: string[]
}

const cases: Case[] = [
  { name: '--version', args: ['--version'] },
  { name: '--help', args: ['--help'] },
  { name: 'export', args: ['export', 'content/index.md', '--out', join(workDir, 'dist')] },
]

interface Result {
  name: string
  median: number
  min: number
}

try {
  const results = cases.map((testCase) => {
    // 初回は実行ファイルがページキャッシュに乗っていない分だけ遅く出ます。
    // 数回捨ててから測ります。
    measure(testCase, 3)
    const samples = measure(testCase, iterations)
    return { name: testCase.name, median: median(samples), min: Math.min(...samples) }
  })

  if (values.json) {
    console.log(JSON.stringify({ binary, iterations, cases: results }, undefined, 2))
  } else {
    print(results)
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

function measure(testCase: Case, count: number): number[] {
  const samples: number[] = []
  for (let i = 0; i < count; i += 1) {
    const started = performance.now()
    // 標準入力は塞ぎます。`export <file>` は読みませんが、繋いだままだと
    // 端末以外とみなす分岐（src/cli.ts）の判定を測定側で揺らしかねません。
    const result = spawnSync(binary, testCase.args, { stdio: ['ignore', 'ignore', 'inherit'] })
    samples.push(performance.now() - started)
    if (result.status !== 0) {
      console.error(`${binary} ${testCase.args.join(' ')} が失敗しました`)
      process.exit(result.status ?? 1)
    }
  }
  return samples
}

function median(samples: number[]): number {
  // 挿入ソートで昇順の複製を作る（サンプル数は数十なので十分速い）。
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

function print(results: Result[]): void {
  const size = statSync(binary).size / 1024 / 1024
  console.log(`iterations=${iterations} binary=${binary} (${size.toFixed(1)} MiB)\n`)
  console.log('case                        median(ms)     min(ms)')
  console.log('-'.repeat(50))
  for (const result of results) {
    console.log(
      `${result.name.padEnd(26)} ${result.median.toFixed(1).padStart(10)} ${result.min.toFixed(1).padStart(11)}`,
    )
  }
}

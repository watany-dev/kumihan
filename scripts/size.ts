/**
 * バンドルサイズのベンチマーク。
 *
 *   bun scripts/size.ts [--minify] [--binary] [--json]
 *
 * `src/cli.ts` を 1 ファイルへバンドルし、生 / minify / gzip のバイト数と、
 * どのモジュールが何バイト占めているかを表示します。`--binary` を付けると
 * `bun build --compile` のスタンドアロン実行ファイルと、その gzip 後の
 * サイズ（Release でのダウンロード量の目安）も測ります。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'

const { values } = parseArgs({
  options: {
    binary: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
})

const bun =
  process.execPath.endsWith('bun') || process.execPath.endsWith('bun.exe')
    ? process.execPath
    : 'bun'

const workDir = mkdtempSync(join(tmpdir(), 'kumihan-size-'))

interface ModuleSize {
  name: string
  bytes: number
}

interface BundleReport {
  raw: number
  minified: number
  gzip: number
  modules: ModuleSize[]
}

try {
  const report = measureBundle()
  const binary = values.binary ? measureBinary() : undefined

  if (values.json) {
    console.log(JSON.stringify({ bundle: report, binary }, undefined, 2))
  } else {
    print(report, binary)
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

function measureBundle(): BundleReport {
  const raw = build(['src/cli.ts', '--target=bun', '--outfile', join(workDir, 'cli.js')])
  const minified = build([
    'src/cli.ts',
    '--target=bun',
    '--minify',
    '--outfile',
    join(workDir, 'cli.min.js'),
  ])

  return {
    raw: raw.length,
    minified: minified.length,
    gzip: gzipSync(minified, { level: 9 }).length,
    modules: attributeModules(raw.toString('utf8')),
  }
}

/**
 * バンドルの `// path/to/module` コメントを目印に、モジュールごとの
 * バイト数へ按分します。minify 前の生バンドルが対象なので絶対値ではなく
 * 「どこが重いか」の比較に使います。
 */
function attributeModules(bundle: string): ModuleSize[] {
  const lines = bundle.split('\n')
  const marks: { index: number; name: string }[] = []

  for (const [index, line] of lines.entries()) {
    if (!line.startsWith('// ') || !line.includes('/')) continue
    marks.push({ index, name: shorten(line.slice(3)) })
  }

  const totals = new Map<string, number>()
  for (const [order, mark] of marks.entries()) {
    const end = marks[order + 1]?.index ?? lines.length
    let bytes = 0
    for (let i = mark.index; i < end; i += 1) {
      bytes += Buffer.byteLength(lines[i] ?? '') + 1
    }
    totals.set(mark.name, (totals.get(mark.name) ?? 0) + bytes)
  }

  // モジュール数は数十なので、挿入ソートで降順に並べます（bench.ts と同じ手）。
  const sorted: ModuleSize[] = []
  for (const [name, bytes] of totals) {
    let index = sorted.length
    for (;;) {
      const previous = index > 0 ? sorted[index - 1] : undefined
      if (previous === undefined || previous.bytes >= bytes) break
      sorted[index] = previous
      index -= 1
    }
    sorted[index] = { name, bytes }
  }
  return sorted
}

function shorten(path: string): string {
  const dependency = path.lastIndexOf('node_modules/')
  if (dependency !== -1) return path.slice(dependency + 'node_modules/'.length)
  const source = path.lastIndexOf('/src/')
  return source === -1 ? path : path.slice(source + 1)
}

function measureBinary(): { bytes: number; gzip: number } {
  const outfile = join(workDir, 'kumihan')
  build(['--compile', '--minify', 'src/cli.ts', '--outfile', outfile])
  const bytes = statSync(outfile).size
  return { bytes, gzip: gzipSync(readFileSync(outfile), { level: 9 }).length }
}

function build(args: string[]): Buffer {
  const outfile = args[args.indexOf('--outfile') + 1] ?? ''
  const result = spawnSync(bun, ['build', ...args], { stdio: ['ignore', 'ignore', 'inherit'] })
  if (result.status !== 0) {
    console.error('bun build failed')
    process.exit(result.status ?? 1)
  }
  return readFileSync(outfile)
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function print(report: BundleReport, binary: { bytes: number; gzip: number } | undefined): void {
  console.log('bundle (src/cli.ts)')
  console.log(`  raw       ${kib(report.raw).padStart(10)}`)
  console.log(`  minified  ${kib(report.minified).padStart(10)}`)
  console.log(`  gzip      ${kib(report.gzip).padStart(10)}`)

  const total = report.modules.reduce((sum, entry) => sum + entry.bytes, 0)
  const dependencies = report.modules
    .filter((entry) => !entry.name.startsWith('src/'))
    .reduce((sum, entry) => sum + entry.bytes, 0)

  console.log(`\nmodules (raw bundle, ${kib(total)}, 依存 ${percent(dependencies, total)})`)
  console.log('  bytes    share  module')
  console.log(`  ${'-'.repeat(58)}`)
  for (const entry of report.modules) {
    if (entry.bytes < total / 200) continue
    console.log(
      `  ${String(entry.bytes).padStart(6)} ${percent(entry.bytes, total).padStart(7)}  ${entry.name}`,
    )
  }

  if (binary) {
    console.log('\nstandalone binary (bun build --compile --minify)')
    console.log(`  file      ${mib(binary.bytes).padStart(10)}`)
    console.log(`  gzip      ${mib(binary.gzip).padStart(10)}`)
  }
}

function percent(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(1)}%`
}

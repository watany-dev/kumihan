import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ENTRY = './src/cli.ts'
const OUT_DIR = 'dist-bin'

const TARGETS = [
  { target: 'bun-linux-x64', outfile: 'kumihan-linux-x64' },
  { target: 'bun-linux-arm64', outfile: 'kumihan-linux-arm64' },
  { target: 'bun-darwin-x64', outfile: 'kumihan-darwin-x64' },
  { target: 'bun-darwin-arm64', outfile: 'kumihan-darwin-arm64' },
  { target: 'bun-windows-x64', outfile: 'kumihan-windows-x64.exe' },
] as const

const bunBin = bunExecutable()

await mkdir(OUT_DIR, { recursive: true })

if (process.argv.includes('--all')) {
  for (const item of TARGETS) {
    compile({ target: item.target, outfile: join(OUT_DIR, item.outfile) })
  }
  await writeChecksums(OUT_DIR)
} else {
  const outfile = join(OUT_DIR, process.platform === 'win32' ? 'kumihan.exe' : 'kumihan')
  compile({ outfile })
}

function bunExecutable(): string {
  const base = process.execPath.replaceAll('\\', '/').split('/').pop()
  if (base === 'bun' || base === 'bun.exe') {
    return process.execPath
  }
  return 'bun'
}

function compile(options: { target?: string; outfile: string }): void {
  const args = ['build', '--compile', '--minify', ENTRY, '--outfile', options.outfile]
  if (options.target !== undefined) {
    args.splice(2, 0, `--target=${options.target}`)
  }

  const label =
    options.target === undefined ? options.outfile : `${options.outfile} (${options.target})`
  console.log(`compile ${label}`)

  const result = spawnSync(bunBin, args, {
    stdio: 'inherit',
    env: { ...process.env, BUN_NO_CODESIGN_MACHO_BINARY: '1' },
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function writeChecksums(dir: string): Promise<void> {
  const names = TARGETS.map((item) => item.outfile).toSorted()
  const lines: string[] = []
  for (const name of names) {
    const hash = createHash('sha256')
      .update(await readFile(join(dir, name)))
      .digest('hex')
    lines.push(`${hash}  ${name}`)
  }
  const dest = join(dir, 'SHA256SUMS.txt')
  await writeFile(dest, `${lines.join('\n')}\n`)
  console.log(`wrote ${dest}`)
}

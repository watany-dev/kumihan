import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

const bun =
  process.execPath.endsWith('bun') || process.execPath.endsWith('bun.exe')
    ? process.execPath
    : 'bun'

await mkdir('dist-bin', { recursive: true })

if (process.argv.includes('--all')) {
  const targets = [
    ['bun-linux-x64', 'dist-bin/kumihan-linux-x64'],
    ['bun-linux-arm64', 'dist-bin/kumihan-linux-arm64'],
    ['bun-darwin-x64', 'dist-bin/kumihan-darwin-x64'],
    ['bun-darwin-arm64', 'dist-bin/kumihan-darwin-arm64'],
    ['bun-windows-x64', 'dist-bin/kumihan-windows-x64.exe'],
  ] as const
  for (const [target, outfile] of targets) {
    run([
      'build',
      '--compile',
      '--minify',
      `--target=${target}`,
      'src/cli.ts',
      '--outfile',
      outfile,
    ])
  }
} else {
  const outfile = process.platform === 'win32' ? 'dist-bin/kumihan.exe' : 'dist-bin/kumihan'
  run(['build', '--compile', '--minify', 'src/cli.ts', '--outfile', outfile])
}

function run(args: string[]): void {
  const result = spawnSync(bun, args, {
    stdio: 'inherit',
    env: { ...process.env, BUN_NO_CODESIGN_MACHO_BINARY: '1' },
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

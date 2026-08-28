import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vite-plus/test'

import { USAGE, VERSION } from '../src/cli/args.js'
import { runCommand, type CliIo } from '../src/cli/run.js'
import { startPreviewServer } from '../src/cli/serve.js'
import { writeExport } from '../src/export/write-files.js'

function captureIo(): CliIo & { logs: string[]; errors: string[] } {
  const logs: string[] = []
  const errors: string[] = []
  return {
    logs,
    errors,
    log: (message) => {
      logs.push(message)
    },
    error: (message) => {
      errors.push(message)
    },
  }
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'kumihan-cli-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('writeExport', () => {
  it('writes print, magazine, and web assets', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'index.md')
      const outDir = join(dir, 'dist')
      await writeFile(source, '# Hello\n')
      const written = await writeExport({
        source,
        outDir,
        title: 'Exported',
        language: 'en',
      })
      assert.deepEqual(written, [
        join(outDir, 'index.html'),
        join(outDir, 'magazine.html'),
        join(outDir, 'web.html'),
        join(outDir, 'assets/typeset.css'),
        join(outDir, 'assets/web.css'),
      ])
      const html = await readFile(join(outDir, 'index.html'), 'utf8')
      assert.match(html, /<html lang="en">/)
      assert.match(html, /<title>Exported<\/title>/)
      assert.match(await readFile(join(outDir, 'magazine.html'), 'utf8'), /magazine/)
    })
  })

  it('omits document options when they are not set', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'index.md')
      await writeFile(source, '# Hello\n')
      const written = await writeExport({ source, outDir: join(dir, 'dist') })
      const html = await readFile(written[0] ?? '', 'utf8')
      assert.match(html, /<html lang="ja">/)
      assert.match(html, /<title>Typeset Preview<\/title>/)
    })
  })
})

describe('startPreviewServer', () => {
  it('serves markdown and reports 127.0.0.1 when bound to 0.0.0.0', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'index.md')
      await writeFile(source, '# Preview\n')
      const started = await startPreviewServer({
        source,
        host: '0.0.0.0',
        port: 0,
        title: 'Live',
        language: 'en',
      })
      try {
        assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+$/)
        const res = await fetch(started.url)
        assert.equal(res.status, 200)
        const html = await res.text()
        assert.match(html, /<html lang="en">/)
        assert.match(html, /<title>Live<\/title>/)
        assert.match(html, /Preview/)
      } finally {
        await started.close()
      }
    })
  })
})

describe('runCommand', () => {
  it('prints help and version', async () => {
    const helpIo = captureIo()
    assert.equal((await runCommand(['--help'], helpIo)).code, 0)
    assert.equal(helpIo.logs.join('\n'), USAGE)

    const versionIo = captureIo()
    assert.equal((await runCommand(['--version'], versionIo)).code, 0)
    assert.equal(versionIo.logs.join('\n'), VERSION)
  })

  it('prints usage on parse errors', async () => {
    const io = captureIo()
    const result = await runCommand([], io)
    assert.equal(result.code, 1)
    assert.match(io.errors.join('\n'), /serve または export/)
    assert.equal(io.errors.at(-1), USAGE)
  })

  it('exports a manuscript through the CLI', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'index.md')
      const outDir = join(dir, 'site')
      await writeFile(source, '# CLI\n')
      const io = captureIo()
      const result = await runCommand(['export', source, '--out', outDir, '--title', 'CLI'], io)
      assert.equal(result.code, 0)
      assert.ok(io.logs.some((line) => line.includes(join(outDir, 'index.html'))))
      assert.match(await readFile(join(outDir, 'index.html'), 'utf8'), /<title>CLI<\/title>/)
    })
  })

  it('reports a missing manuscript on export', async () => {
    const io = captureIo()
    const result = await runCommand(['export', './content/does-not-exist.md'], io)
    assert.equal(result.code, 1)
    assert.match(io.errors.join('\n'), /原稿が見つかりません/)
  })

  it('reports a generic export failure without leaking filesystem details', async () => {
    await withTempDir(async (dir) => {
      const io = captureIo()
      const result = await runCommand(['export', dir, '--out', join(dir, 'out')], io)
      assert.equal(result.code, 1)
      assert.match(io.errors.join('\n'), /export に失敗しました/)
      assert.equal(io.errors.join('\n').includes('EISDIR'), false)
    })
  })

  it('starts a preview server through the CLI', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'index.md')
      await writeFile(source, '# Run\n')
      const io = captureIo()
      const result = await runCommand(['serve', source, '--host', '127.0.0.1', '--port', '0'], io)
      assert.equal(result.code, 0)
      assert.ok(result.close)
      try {
        const preview = io.logs[0]
        assert.ok(preview)
        assert.match(preview, /^Typeset preview: http:\/\/127\.0\.0\.1:\d+$/)
        const url = preview.replace('Typeset preview: ', '')
        const res = await fetch(url)
        assert.equal(res.status, 200)
        assert.match(io.logs.join('\n'), /magazine\.html/)
        assert.match(io.logs.join('\n'), /web\.html/)
      } finally {
        await result.close?.()
      }
    })
  })

  it('reports a bind failure when the port is already in use', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve) => {
      blocker.listen(0, '127.0.0.1', resolve)
    })
    const address = blocker.address()
    assert.ok(address && typeof address === 'object')
    try {
      await withTempDir(async (dir) => {
        const source = join(dir, 'index.md')
        await writeFile(source, '# Busy\n')
        const io = captureIo()
        const result = await runCommand(
          ['serve', source, '--host', '127.0.0.1', '--port', String(address.port)],
          io,
        )
        assert.equal(result.code, 1)
        assert.equal(result.close, undefined)
        assert.match(io.errors.join('\n'), /プレビューサーバを起動できませんでした/)
      })
    } finally {
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  })
})

describe('writeExport errors', () => {
  it('creates nested asset directories', async () => {
    await withTempDir(async (dir) => {
      const nested = join(dir, 'deep', 'out')
      await mkdir(join(dir, 'deep'), { recursive: true })
      const source = join(dir, 'a.md')
      await writeFile(source, '# Nested\n')
      const written = await writeExport({ source, outDir: nested })
      assert.ok(written.some((path) => path.endsWith('assets/web.css')))
    })
  })
})

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vite-plus/test'

import { memoryManuscript, toManuscript } from '../src/manuscript.js'

describe('toManuscript', () => {
  it('re-reads a path on every read so edits show up, and resolves images beside it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-manuscript-'))
    try {
      const source = join(dir, 'index.md')
      await writeFile(source, '# 最初\n')
      const manuscript = toManuscript(source)
      assert.equal(manuscript.root, dir)
      assert.equal(manuscript.file, source)
      assert.equal(await manuscript.read(), '# 最初\n')
      await writeFile(source, '# 次\n')
      assert.equal(await manuscript.read(), '# 次\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('propagates ENOENT so callers can report a missing manuscript', async () => {
    await assert.rejects(
      toManuscript(join(tmpdir(), 'kumihan-missing-manuscript.md')).read(),
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
    )
  })

  it('passes a manuscript through untouched', () => {
    const manuscript = memoryManuscript('# そのまま\n')
    assert.equal(toManuscript(manuscript), manuscript)
  })
})

describe('memoryManuscript', () => {
  it('returns the same text and defaults its root to the working directory', async () => {
    const manuscript = memoryManuscript('# パイプ\n')
    assert.equal(manuscript.root, process.cwd())
    assert.equal(manuscript.file, undefined)
    assert.equal(await manuscript.read(), '# パイプ\n')
  })
})

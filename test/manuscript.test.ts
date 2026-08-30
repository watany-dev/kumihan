import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { describe, it } from 'vite-plus/test'

import { fileManuscript, memoryManuscript, toManuscript } from '../src/manuscript.js'

describe('fileManuscript', () => {
  it('resolves images against the directory holding the manuscript', () => {
    const manuscript = fileManuscript('content/index.md')
    assert.equal(manuscript.root, dirname(resolve('content/index.md')))
  })

  it('re-reads the file on every read so edits show up', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-manuscript-'))
    try {
      const source = join(dir, 'index.md')
      await writeFile(source, '# 最初\n')
      const manuscript = fileManuscript(source)
      assert.equal(await manuscript.read(), '# 最初\n')
      await writeFile(source, '# 次\n')
      assert.equal(await manuscript.read(), '# 次\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('propagates ENOENT so callers can report a missing manuscript', async () => {
    const manuscript = fileManuscript(join(tmpdir(), 'kumihan-missing-manuscript.md'))
    await assert.rejects(manuscript.read(), (error: NodeJS.ErrnoException) => {
      assert.equal(error.code, 'ENOENT')
      return true
    })
  })
})

describe('memoryManuscript', () => {
  it('returns the same text and defaults its root to the working directory', async () => {
    const manuscript = memoryManuscript('# パイプ\n')
    assert.equal(manuscript.root, resolve(process.cwd()))
    assert.equal(await manuscript.read(), '# パイプ\n')
    assert.equal(await manuscript.read(), '# パイプ\n')
  })

  it('accepts an explicit root', () => {
    assert.equal(memoryManuscript('x', 'content').root, resolve('content'))
  })
})

describe('toManuscript', () => {
  it('treats a string as a file path', () => {
    assert.equal(toManuscript('content/index.md').root, dirname(resolve('content/index.md')))
  })

  it('passes a manuscript through untouched', () => {
    const manuscript = memoryManuscript('# そのまま\n')
    assert.equal(toManuscript(manuscript), manuscript)
  })
})

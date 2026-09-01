import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vite-plus/test'

import { probeGit, readHeadFile } from '../src/git-source.js'

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

async function initRepo(prefix: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.name', 't'])
  git(dir, ['config', 'user.email', 't@example.com'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  const file = join(dir, 'index.md')
  await writeFile(file, '# 初版\n\n古い段落。\n')
  git(dir, ['add', '--', 'index.md'])
  git(dir, ['commit', '-m', 'init'])
  return { dir, file }
}

describe('probeGit', () => {
  it('accepts a tracked file inside a temporary repository', async () => {
    const { dir, file } = await initRepo('kumihan-git-ok-')
    try {
      const tracked = await probeGit(file)
      assert.ok(tracked)
      assert.equal(tracked.rel, 'index.md')
      assert.equal(tracked.toplevel, dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects an untracked file', async () => {
    const { dir } = await initRepo('kumihan-git-untracked-')
    try {
      const extra = join(dir, 'extra.md')
      await writeFile(extra, '# 未追跡\n')
      assert.equal(await probeGit(extra), null)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a file outside any repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-git-outside-'))
    try {
      const file = join(dir, 'index.md')
      await writeFile(file, '# 外\n')
      assert.equal(await probeGit(file), null)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a path with a newline or NUL', async () => {
    assert.equal(await probeGit('/tmp/foo\nbar.md'), null)
    assert.equal(await probeGit('/tmp/foo\rbar.md'), null)
    assert.equal(await probeGit('/tmp/foo\0bar.md'), null)
  })

  it('does not pass a path to the shell', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-git-shell-'))
    try {
      const pwned = join(dir, 'pwned')
      const nasty = join(dir, 'doc.md; touch pwned')
      assert.equal(await probeGit(nasty), null)
      assert.equal(existsSync(pwned), false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('readHeadFile', () => {
  it('returns the committed blob', async () => {
    const { dir, file } = await initRepo('kumihan-git-head-')
    try {
      const tracked = await probeGit(file)
      assert.ok(tracked)
      const head = await readHeadFile(tracked)
      assert.ok(head)
      assert.equal(head.text, '# 初版\n\n古い段落。\n')
      assert.ok(head.oid.length > 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns an empty blob for a newly added file that is not in HEAD', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-git-added-'))
    try {
      git(dir, ['init', '-b', 'main'])
      git(dir, ['config', 'user.name', 't'])
      git(dir, ['config', 'user.email', 't@example.com'])
      git(dir, ['config', 'commit.gpgsign', 'false'])
      const file = join(dir, 'index.md')
      await writeFile(file, '# 新規\n')
      git(dir, ['add', '--', 'index.md'])
      const tracked = await probeGit(file)
      assert.ok(tracked)
      const head = await readHeadFile(tracked)
      assert.deepEqual(head, { oid: '', text: '' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns null when cat-file cannot read the blob', async () => {
    const { dir, file } = await initRepo('kumihan-git-cat-')
    try {
      const tracked = await probeGit(file)
      assert.ok(tracked)
      const oid = git(dir, ['rev-parse', 'HEAD:index.md']).trim()
      await rm(join(dir, '.git', 'objects', oid.slice(0, 2), oid.slice(2)))
      assert.equal(await readHeadFile(tracked), null)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('probes a tracked file in a subdirectory', async () => {
    const { dir } = await initRepo('kumihan-git-nested-')
    try {
      const nested = join(dir, 'docs')
      await mkdir(nested)
      const file = join(nested, 'a.md')
      await writeFile(file, '# 中\n')
      git(dir, ['add', '--', 'docs/a.md'])
      git(dir, ['commit', '-m', 'nested'])
      const tracked = await probeGit(file)
      assert.ok(tracked)
      assert.equal(tracked.rel, 'docs/a.md')
      const head = await readHeadFile(tracked)
      assert.ok(head)
      assert.equal(head.text, '# 中\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

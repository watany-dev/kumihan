import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vite-plus/test'

import { imageContentType, resolveManuscriptFile } from '../src/manuscript-path.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('imageContentType', () => {
  it('maps allowlisted extensions and ignores case', () => {
    assert.equal(imageContentType('a.png'), 'image/png')
    assert.equal(imageContentType('a.JPG'), 'image/jpeg')
    assert.equal(imageContentType('a.svg'), 'image/svg+xml')
    assert.equal(imageContentType('a.md'), undefined)
    assert.equal(imageContentType('a.png.txt'), undefined)
  })
})

describe('resolveManuscriptFile', () => {
  it('rejects empty, NUL, backslash, scheme, absolute, and unknown extension', async () => {
    const root = '/tmp/kumihan-ms'
    assert.equal(await resolveManuscriptFile(root, ''), null)
    assert.equal(await resolveManuscriptFile(root, 'a\0.png'), null)
    assert.equal(await resolveManuscriptFile(root, 'a\\b.png'), null)
    assert.equal(await resolveManuscriptFile(root, 'https://x/a.png'), null)
    assert.equal(await resolveManuscriptFile(root, '/etc/passwd.png'), null)
    assert.equal(await resolveManuscriptFile(root, 'notes.md'), null)
    assert.equal(await resolveManuscriptFile(root, '%2e%2e/secret.png'), null)
    assert.equal(await resolveManuscriptFile(root, '../secret.png'), null)
    assert.equal(await resolveManuscriptFile(root, '%zz.png'), null)
  })

  it('resolves a file inside the manuscript directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-path-'))
    try {
      await writeFile(join(dir, 'a.png'), PNG)
      const resolved = await resolveManuscriptFile(dir, 'a.png')
      assert.equal(resolved, await realpath(join(dir, 'a.png')))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a symlink that leaves the root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-path-link-'))
    const root = join(dir, 'ms')
    try {
      await mkdir(root)
      await writeFile(join(dir, 'secret.png'), PNG)
      await symlink(join(dir, 'secret.png'), join(root, 'link.png'))
      assert.equal(await resolveManuscriptFile(root, 'link.png'), null)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('allows a symlink that stays inside the root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-path-in-'))
    try {
      await writeFile(join(dir, 'a.png'), PNG)
      await symlink(join(dir, 'a.png'), join(dir, 'b.png'))
      assert.equal(await resolveManuscriptFile(dir, 'b.png'), await realpath(join(dir, 'a.png')))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

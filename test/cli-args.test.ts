import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { describe, it } from 'vite-plus/test'

function packageVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync('package.json', 'utf8'))
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    typeof parsed.version === 'string'
  ) {
    return parsed.version
  }
  throw new Error('package.json version is missing')
}

import {
  DEFAULT_HOST,
  DEFAULT_OUT_DIR,
  DEFAULT_PORT,
  DEFAULT_SOURCE,
  parseArgs,
  USAGE,
  VERSION,
} from '../src/cli/args.js'

describe('parseArgs', () => {
  it('keeps VERSION in sync with package.json', () => {
    assert.equal(VERSION, packageVersion())
  })

  it('rejects an empty argv', () => {
    const parsed = parseArgs([])
    assert.equal(parsed.ok, false)
    if (!parsed.ok) {
      assert.match(parsed.message, /serve または export/)
    }
  })

  it('returns help and version', () => {
    assert.deepEqual(parseArgs(['--help']), { ok: true, command: { type: 'help' } })
    assert.deepEqual(parseArgs(['-h']), { ok: true, command: { type: 'help' } })
    assert.deepEqual(parseArgs(['serve', '--help']), { ok: true, command: { type: 'help' } })
    assert.deepEqual(parseArgs(['--version']), { ok: true, command: { type: 'version' } })
    assert.deepEqual(parseArgs(['-v']), { ok: true, command: { type: 'version' } })
    assert.match(USAGE, /kumihan serve/)
  })

  it('parses serve defaults and overrides', () => {
    assert.deepEqual(parseArgs(['serve']), {
      ok: true,
      command: {
        type: 'serve',
        source: DEFAULT_SOURCE,
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
      },
    })
    assert.deepEqual(
      parseArgs([
        'serve',
        'notes.md',
        '--port',
        '4000',
        '--host',
        '0.0.0.0',
        '--title',
        'Draft',
        '--lang',
        'en',
      ]),
      {
        ok: true,
        command: {
          type: 'serve',
          source: 'notes.md',
          host: '0.0.0.0',
          port: 4000,
          title: 'Draft',
          language: 'en',
        },
      },
    )
    assert.deepEqual(parseArgs(['-p=0', '-H', '127.0.0.1', '--language', 'ja', 'serve']), {
      ok: true,
      command: {
        type: 'serve',
        source: DEFAULT_SOURCE,
        host: '127.0.0.1',
        port: 0,
        language: 'ja',
      },
    })
    assert.deepEqual(parseArgs(['serve', '--port=65535']), {
      ok: true,
      command: {
        type: 'serve',
        source: DEFAULT_SOURCE,
        host: DEFAULT_HOST,
        port: 65535,
      },
    })
  })

  it('parses export defaults and overrides', () => {
    assert.deepEqual(parseArgs(['export']), {
      ok: true,
      command: {
        type: 'export',
        source: DEFAULT_SOURCE,
        outDir: DEFAULT_OUT_DIR,
      },
    })
    assert.deepEqual(parseArgs(['export', 'a.md', '-o', 'out', '--title', 'Hi']), {
      ok: true,
      command: {
        type: 'export',
        source: 'a.md',
        outDir: 'out',
        title: 'Hi',
      },
    })
    assert.deepEqual(parseArgs(['--out=build', 'export']), {
      ok: true,
      command: {
        type: 'export',
        source: DEFAULT_SOURCE,
        outDir: 'build',
      },
    })
  })

  it('accepts positionals after --', () => {
    assert.deepEqual(parseArgs(['--', 'serve', 'a.md']), {
      ok: true,
      command: {
        type: 'serve',
        source: 'a.md',
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
      },
    })
  })

  it('skips holes in argv', () => {
    const argv: string[] = []
    argv[0] = 'serve'
    argv[2] = 'notes.md'
    assert.deepEqual(parseArgs(argv), {
      ok: true,
      command: {
        type: 'serve',
        source: 'notes.md',
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
      },
    })
  })

  it('rejects unknown commands, flags, and extra args', () => {
    assert.equal(parseArgs(['build']).ok, false)
    assert.equal(parseArgs(['--bogus']).ok, false)
    assert.equal(parseArgs(['--bogus=1']).ok, false)
    assert.equal(parseArgs(['serve', 'a.md', 'b.md']).ok, false)
    assert.equal(parseArgs(['--', 'serve', 'a.md', 'extra']).ok, false)
  })

  it('rejects missing, empty, and invalid option values', () => {
    assert.equal(parseArgs(['serve', '--port']).ok, false)
    assert.equal(parseArgs(['serve', '--port', '--help']).ok, false)
    assert.equal(parseArgs(['serve', '--port=']).ok, false)
    assert.equal(parseArgs(['serve', '--port', 'abc']).ok, false)
    assert.equal(parseArgs(['serve', '--port', '65536']).ok, false)
    assert.equal(parseArgs(['serve', '--port', '-1']).ok, false)
  })

  it('rejects duplicate options and command-specific flags', () => {
    assert.equal(parseArgs(['serve', '--port', '1', '--port', '2']).ok, false)
    assert.equal(parseArgs(['serve', '--host', 'a', '--host', 'b']).ok, false)
    assert.equal(parseArgs(['export', '--out', 'a', '--out', 'b']).ok, false)
    assert.equal(parseArgs(['serve', '--title', 'a', '--title', 'b']).ok, false)
    assert.equal(parseArgs(['serve', '--lang', 'ja', '--language', 'en']).ok, false)
    assert.equal(parseArgs(['serve', '--out', 'dist']).ok, false)
    assert.equal(parseArgs(['export', '--port', '3000']).ok, false)
    assert.equal(parseArgs(['export', '--host', '127.0.0.1']).ok, false)
  })
})

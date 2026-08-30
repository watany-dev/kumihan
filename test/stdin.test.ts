import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'

import { describe, it } from 'vite-plus/test'

import { readStdin } from '../src/stdin.js'

async function* chunks(...parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield part
  }
}

describe('readStdin', () => {
  it('joins chunks into one utf-8 string', async () => {
    const text = await readStdin(chunks(Buffer.from('# 見出し\n'), Buffer.from('本文です。\n')))
    assert.equal(text, '# 見出し\n本文です。\n')
  })

  it('keeps multibyte characters split across chunk boundaries intact', async () => {
    const bytes = Buffer.from('日本語の原稿')
    const head = bytes.subarray(0, 4)
    const tail = bytes.subarray(4)
    assert.notEqual(tail.length, 0)
    // 4 バイト目は「本」の途中なので、チャンクごとにデコードすると壊れる。
    const text = await readStdin(chunks(head, tail))
    assert.equal(text, '日本語の原稿')
  })

  it('returns an empty string for an empty stream', async () => {
    assert.equal(await readStdin(chunks()), '')
  })
})

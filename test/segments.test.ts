import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import {
  normalizeMarkdown,
  renderMarkdown,
  renderMarkdownPiece,
  resetRenderCache,
} from '../src/markdown/render.js'
import { splitSegments } from '../src/markdown/segments.js'

const MANUSCRIPT = [
  '# 見出し',
  '',
  '最初の段落です。**強調**も入っています。',
  '',
  '- 一つ',
  '- 二つ',
  '',
  '> 引用の段落',
  '> 二行目',
  '',
  '```',
  'コードの中',
  '',
  '空行をまたぐコード',
  '```',
  '',
  '| 左 | 右 |',
  '| --- | --- |',
  '| a | b |',
  '',
  '最後の段落。',
].join('\n')

function joinPieces(source: string): string {
  let html = ''
  for (const segment of splitSegments(normalizeMarkdown(source))) {
    const piece = renderMarkdownPiece(segment)
    if (piece.length === 0) continue
    html = html.length === 0 ? piece : `${html}\n${piece}`
  }
  return html
}

describe('splitSegments', () => {
  it('keeps a fence spanning blank lines as one segment', () => {
    const source = ['```', 'foo', '', 'bar', '```', '', 'あと'].join('\n')
    assert.deepEqual(splitSegments(normalizeMarkdown(source)), [
      ['```', 'foo', '', 'bar', '```'].join('\n'),
      'あと',
    ])
  })

  it('joins piece renders to the same html as renderMarkdown', () => {
    const fenced = ['```', 'first', '', 'second', '```', '', '段落。'].join('\n')
    const spaced = '段落一。\n\n \n\n段落二。'
    const crlf = '段落一。\r\n\r\n段落二。\r\n\r\n段落三。'
    for (const source of [MANUSCRIPT, '', '\n\n', ' \n\n ', fenced, spaced, crlf, '# だけ\n']) {
      resetRenderCache()
      assert.equal(joinPieces(source), renderMarkdown(source), source)
    }
  })

  it('does not touch the incremental cache', () => {
    resetRenderCache()
    const first = renderMarkdown('# A\n\nB')
    renderMarkdownPiece('別の区画')
    assert.equal(renderMarkdown('# A\n\nB'), first)
  })
})

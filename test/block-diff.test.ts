import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { diffSegments, renderBlockDiff } from '../src/diff/block-diff.js'
import { normalizeMarkdown, renderMarkdownPiece } from '../src/markdown/render.js'

describe('diffSegments', () => {
  it('keeps A, deletes B, adds C', () => {
    assert.deepEqual(diffSegments(['A', 'B'], ['A', 'C']), [
      { kind: 'keep', text: 'A' },
      { kind: 'del', text: 'B' },
      { kind: 'add', text: 'C' },
    ])
  })

  it('drops blank segments from the sequence', () => {
    assert.deepEqual(diffSegments(['A', '   ', 'B'], ['A', '\n', 'C']), [
      { kind: 'keep', text: 'A' },
      { kind: 'del', text: 'B' },
      { kind: 'add', text: 'C' },
    ])
  })

  it('treats identical sequences as all keep', () => {
    assert.deepEqual(diffSegments(['A', 'B'], ['A', 'B']), [
      { kind: 'keep', text: 'A' },
      { kind: 'keep', text: 'B' },
    ])
  })

  it('treats empty against content as all add', () => {
    assert.deepEqual(diffSegments([], ['A', 'B']), [
      { kind: 'add', text: 'A' },
      { kind: 'add', text: 'B' },
    ])
  })

  it('treats content against empty as all del', () => {
    assert.deepEqual(diffSegments(['A', 'B'], []), [
      { kind: 'del', text: 'A' },
      { kind: 'del', text: 'B' },
    ])
  })
})

describe('renderBlockDiff', () => {
  it('wraps a changed pair with removed then added', () => {
    const html = renderBlockDiff('A\n\nB', 'A\n\nC', (segment) => segment)
    assert.equal(html, 'A\n<div class="diff-removed">B</div>\n<div class="diff-added">C</div>')
  })

  it('merges consecutive dels and consecutive adds into one wrapper each', () => {
    const html = renderBlockDiff('K\n\nD1\n\nD2', 'K\n\nA1\n\nA2', (segment) => segment)
    assert.equal(
      html,
      'K\n<div class="diff-removed">D1\nD2</div>\n<div class="diff-added">A1\nA2</div>',
    )
  })

  it('does not wrap unchanged segments', () => {
    const html = renderBlockDiff(
      '# 見出し\n\n同じ段落。',
      '# 見出し\n\n同じ段落。',
      renderMarkdownPiece,
    )
    assert.equal(html, renderMarkdownPiece('# 見出し') + '\n' + renderMarkdownPiece('同じ段落。'))
    assert.equal(html.includes('diff-'), false)
  })

  it('renders empty manuscripts to empty html', () => {
    assert.equal(renderBlockDiff('', '', renderMarkdownPiece), '')
    assert.equal(renderBlockDiff(' \n\n ', '', renderMarkdownPiece), '')
  })

  it('keeps a fence spanning blank lines as one changed unit', () => {
    const oldSrc = normalizeMarkdown(['```', 'foo', '', 'bar', '```'].join('\n'))
    const newSrc = normalizeMarkdown(['```', 'FOO', '', 'bar', '```'].join('\n'))
    const html = renderBlockDiff(oldSrc, newSrc, renderMarkdownPiece)
    assert.match(html, /class="diff-removed"/)
    assert.match(html, /class="diff-added"/)
    assert.equal((html.match(/<pre>/g) ?? []).length, 2)
  })
})

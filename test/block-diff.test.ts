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
  it('marks a changed pair on each block', () => {
    const html = renderBlockDiff('A\n\nB', 'A\n\nC', renderMarkdownPiece)
    assert.equal(html, '<p>A</p>\n<p class="diff-removed">B</p>\n<p class="diff-added">C</p>')
  })

  it('marks consecutive changes on each block, not a wrapper', () => {
    const html = renderBlockDiff('K\n\nD1\n\nD2', 'K\n\nA1\n\nA2', renderMarkdownPiece)
    assert.equal(html.includes('<div class="diff-'), false)
    assert.equal(
      html,
      '<p>K</p>\n<p class="diff-removed">D1</p>\n<p class="diff-removed">D2</p>\n<p class="diff-added">A1</p>\n<p class="diff-added">A2</p>',
    )
  })

  it('does not mark unchanged segments', () => {
    const html = renderBlockDiff(
      '# 見出し\n\n同じ段落。',
      '# 見出し\n\n同じ段落。',
      renderMarkdownPiece,
    )
    assert.equal(html, renderMarkdownPiece('# 見出し') + '\n' + renderMarkdownPiece('同じ段落。'))
    assert.equal(html.includes('diff-'), false)
  })

  it('does not treat a trailing newline on the last segment as a change', () => {
    const html = renderBlockDiff('A\n\nB\n', 'A\n\nB\n\nC\n', renderMarkdownPiece)
    assert.equal(html, '<p>A</p>\n<p>B</p>\n<p class="diff-added">C</p>')
  })

  it('renders empty manuscripts to empty html', () => {
    assert.equal(renderBlockDiff('', '', renderMarkdownPiece), '')
    assert.equal(renderBlockDiff(' \n\n ', '', renderMarkdownPiece), '')
  })

  it('keeps a fence spanning blank lines as one changed unit', () => {
    const oldSrc = normalizeMarkdown(['```', 'foo', '', 'bar', '```'].join('\n'))
    const newSrc = normalizeMarkdown(['```', 'FOO', '', 'bar', '```'].join('\n'))
    const html = renderBlockDiff(oldSrc, newSrc, renderMarkdownPiece)
    assert.match(html, /<pre class="diff-removed">/)
    assert.match(html, /<pre class="diff-added">/)
    assert.equal((html.match(/<pre\b/g) ?? []).length, 2)
  })

  it('marks every block inside a multi-block segment', () => {
    const html = renderBlockDiff('', '## 節\n段落。', renderMarkdownPiece)
    assert.match(html, /<h2 class="diff-added">節<\/h2>/)
    assert.match(html, /<p class="diff-added">段落。<\/p>/)
    assert.equal(html.includes('<div class="diff-'), false)
  })
})

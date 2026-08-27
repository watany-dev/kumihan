import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { renderMarkdown } from '../src/markdown/render.js'

describe('markdown edge cases', () => {
  it('normalizes CRLF line endings', () => {
    assert.equal(renderMarkdown('# Title\r\n\r\nHello'), '<h1>Title</h1>\n<p>Hello</p>')
  })

  it('returns an empty string for blank input', () => {
    assert.equal(renderMarkdown(''), '')
    assert.equal(renderMarkdown('\n\n'), '')
  })

  it('treats a hash without a following space as a paragraph', () => {
    assert.equal(renderMarkdown('#not-a-heading'), '<p>#not-a-heading</p>')
  })

  it('does not treat h4 as a heading', () => {
    assert.equal(renderMarkdown('#### too deep'), '<p>#### too deep</p>')
  })

  it('closes an unterminated fenced code block at EOF', () => {
    const html = renderMarkdown(['```', 'still code'].join('\n'))
    assert.equal(html, '<pre><code>still code</code></pre>')
  })

  it('renders a blockquote that has no space after >', () => {
    assert.equal(renderMarkdown('>quoted'), '<blockquote>\n<p>quoted</p>\n</blockquote>')
  })

  it('leaves unmatched emphasis markers as text', () => {
    assert.equal(renderMarkdown('**not closed'), '<p>**not closed</p>')
    assert.equal(renderMarkdown('*not closed'), '<p>*not closed</p>')
    assert.equal(renderMarkdown('`not closed'), '<p>`not closed</p>')
  })

  it('leaves incomplete links as text', () => {
    assert.equal(renderMarkdown('[text](https://example.com'), '<p>[text](https://example.com</p>')
    assert.equal(renderMarkdown('[text]no-url'), '<p>[text]no-url</p>')
  })

  it('does not put a space before an empty continuation after a hard break', () => {
    assert.equal(renderMarkdown('first  \n'), '<p>first</p>')
  })

  it('stops a paragraph when the next line starts a block', () => {
    assert.equal(
      renderMarkdown(['hello', '```', 'code', '```'].join('\n')),
      '<p>hello</p>\n<pre><code>code</code></pre>',
    )
    assert.equal(renderMarkdown(['hello', '# Title'].join('\n')), '<p>hello</p>\n<h1>Title</h1>')
    assert.equal(renderMarkdown(['hello', '---'].join('\n')), '<p>hello</p>\n<hr>')
    assert.equal(
      renderMarkdown(['hello', '> quoted'].join('\n')),
      '<p>hello</p>\n<blockquote>\n<p>quoted</p>\n</blockquote>',
    )
    assert.equal(
      renderMarkdown(['hello', '- item'].join('\n')),
      '<p>hello</p>\n<ul>\n<li>item</li>\n</ul>',
    )
    assert.equal(
      renderMarkdown(['hello', '1. item'].join('\n')),
      '<p>hello</p>\n<ol>\n<li>item</li>\n</ol>',
    )
  })

  it('does not insert a space around CJK compatibility and fullwidth characters', () => {
    assert.equal(renderMarkdown('hello\n世界'), '<p>hello世界</p>')
    assert.equal(renderMarkdown('豈\nnext'), '<p>豈next</p>')
    assert.equal(renderMarkdown('Ａ\nＢ'), '<p>ＡＢ</p>')
  })
})

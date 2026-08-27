import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderMarkdown } from '../src/markdown/render.js'

describe('renderMarkdown', () => {
  it('renders heading 1', () => {
    assert.equal(renderMarkdown('# Heading 1'), '<h1>Heading 1</h1>')
  })

  it('renders heading 2', () => {
    assert.equal(renderMarkdown('## Heading 2'), '<h2>Heading 2</h2>')
  })

  it('renders heading 3', () => {
    assert.equal(renderMarkdown('### Heading 3'), '<h3>Heading 3</h3>')
  })

  it('renders a paragraph', () => {
    assert.equal(renderMarkdown('Hello world.'), '<p>Hello world.</p>')
  })

  it('renders strong', () => {
    assert.equal(renderMarkdown('**bold**'), '<p><strong>bold</strong></p>')
  })

  it('renders emphasis', () => {
    assert.equal(renderMarkdown('*emphasis*'), '<p><em>emphasis</em></p>')
  })

  it('renders inline code', () => {
    assert.equal(renderMarkdown('`inline code`'), '<p><code>inline code</code></p>')
  })

  it('does not interpret markdown inside inline code', () => {
    assert.equal(
      renderMarkdown('`**not bold**`'),
      '<p><code>**not bold**</code></p>',
    )
  })

  it('renders a fenced code block', () => {
    const source = ['```ts', 'const value = 1', '```'].join('\n')
    assert.equal(
      renderMarkdown(source),
      '<pre><code>const value = 1</code></pre>',
    )
  })

  it('preserves whitespace in a code block', () => {
    const source = ['```', 'line one', '  indented', '```'].join('\n')
    assert.equal(
      renderMarkdown(source),
      '<pre><code>line one\n  indented</code></pre>',
    )
  })

  it('does not interpret markdown inside a code block', () => {
    const source = ['```', '# not a heading', '**not bold**', '```'].join('\n')
    assert.equal(
      renderMarkdown(source),
      '<pre><code># not a heading\n**not bold**</code></pre>',
    )
  })

  it('renders a blockquote', () => {
    assert.equal(
      renderMarkdown('> quoted text'),
      '<blockquote>\n<p>quoted text</p>\n</blockquote>',
    )
  })

  it('renders an unordered list', () => {
    const source = ['- unordered', '- list'].join('\n')
    assert.equal(
      renderMarkdown(source),
      '<ul>\n<li>unordered</li>\n<li>list</li>\n</ul>',
    )
  })

  it('renders an ordered list', () => {
    const source = ['1. ordered', '2. list'].join('\n')
    assert.equal(
      renderMarkdown(source),
      '<ol>\n<li>ordered</li>\n<li>list</li>\n</ol>',
    )
  })

  it('renders a link', () => {
    assert.equal(
      renderMarkdown('[link](https://example.com)'),
      '<p><a href="https://example.com">link</a></p>',
    )
  })

  it('renders a relative link', () => {
    assert.equal(
      renderMarkdown('[local](./page.html)'),
      '<p><a href="./page.html">local</a></p>',
    )
  })

  it('renders a fragment link', () => {
    assert.equal(
      renderMarkdown('[section](#heading)'),
      '<p><a href="#heading">section</a></p>',
    )
  })

  it('renders a mailto link', () => {
    assert.equal(
      renderMarkdown('[mail](mailto:a@example.com)'),
      '<p><a href="mailto:a@example.com">mail</a></p>',
    )
  })

  it('renders a horizontal rule', () => {
    assert.equal(renderMarkdown('---'), '<hr>')
  })

  it('renders inline markup inside a heading', () => {
    assert.equal(
      renderMarkdown('# Use **bold**'),
      '<h1>Use <strong>bold</strong></h1>',
    )
  })

  it('keeps adjacent blocks separate', () => {
    const source = ['# Title', '', 'A paragraph.', '', '- item'].join('\n')
    assert.equal(
      renderMarkdown(source),
      '<h1>Title</h1>\n<p>A paragraph.</p>\n<ul>\n<li>item</li>\n</ul>',
    )
  })
})

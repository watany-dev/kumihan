import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { renderMarkdown } from '../src/markdown/render.js'
import { parseAlignments, splitTableRow } from '../src/markdown/table.js'

function tableHtml(...lines: string[]): string {
  return ['<div class="table-wrap">', ...lines, '</div>'].join('\n')
}

describe('splitTableRow', () => {
  it('returns no cells for a blank line', () => {
    assert.deepEqual(splitTableRow(''), [])
    assert.deepEqual(splitTableRow('   '), [])
  })

  it('drops the outer pipes and trims cells', () => {
    assert.deepEqual(splitTableRow('| 項目 | 値 |'), ['項目', '値'])
    assert.deepEqual(splitTableRow('項目 | 値'), ['項目', '値'])
    assert.deepEqual(splitTableRow('| 項目 | 値'), ['項目', '値'])
  })

  it('keeps an empty cell between pipes', () => {
    assert.deepEqual(splitTableRow('| a | | b |'), ['a', '', 'b'])
  })

  it('does not split on a pipe inside a code span', () => {
    assert.deepEqual(splitTableRow('| `a|b` | c |'), ['`a|b`', 'c'])
  })

  it('treats an escaped pipe as cell text', () => {
    assert.deepEqual(splitTableRow('| a \\| b | c |'), ['a | b', 'c'])
  })
})

describe('parseAlignments', () => {
  it('reads left, center, right, and default cells', () => {
    assert.deepEqual(parseAlignments('| :--- | :---: | ---: | --- |'), [
      'left',
      'center',
      'right',
      null,
    ])
  })

  it('rejects a line with no pipe or too few dashes', () => {
    assert.equal(parseAlignments('---'), null)
    assert.equal(parseAlignments('| -- | --- |'), null)
    assert.equal(parseAlignments('| foo | --- |'), null)
  })
})

describe('renderMarkdown tables', () => {
  it('renders a pipe table instead of joining the rows into a paragraph', () => {
    const source = ['| 項目 | 値', '| --- | ---', '| 名前 | 太郎'].join('\n')
    assert.equal(
      renderMarkdown(source),
      tableHtml(
        '<table>',
        '<thead>',
        '<tr><th>項目</th><th>値</th></tr>',
        '</thead>',
        '<tbody>',
        '<tr><td>名前</td><td>太郎</td></tr>',
        '</tbody>',
        '</table>',
      ),
    )
  })

  it('does not glue a CJK cell to the delimiter when outer pipes are omitted', () => {
    const source = ['項目 | 値', '--- | ---', '名前 | 太郎'].join('\n')
    assert.equal(
      renderMarkdown(source),
      tableHtml(
        '<table>',
        '<thead>',
        '<tr><th>項目</th><th>値</th></tr>',
        '</thead>',
        '<tbody>',
        '<tr><td>名前</td><td>太郎</td></tr>',
        '</tbody>',
        '</table>',
      ),
    )
  })

  it('does not let a code span swallow the following rows', () => {
    const source = ['| `open | x |', '| --- | --- |', '| y | close` |'].join('\n')
    assert.equal(
      renderMarkdown(source),
      tableHtml(
        '<table>',
        '<thead>',
        '<tr><th>`open</th><th>x</th></tr>',
        '</thead>',
        '<tbody>',
        '<tr><td>y</td><td>close`</td></tr>',
        '</tbody>',
        '</table>',
      ),
    )
  })

  it('renders inline markup inside cells', () => {
    const source = [
      '| **太** | *斜* | `code` |',
      '| --- | --- | --- |',
      '| [link](https://example.com) | a | b |',
    ].join('\n')
    assert.equal(
      renderMarkdown(source),
      tableHtml(
        '<table>',
        '<thead>',
        '<tr><th><strong>太</strong></th><th><em>斜</em></th><th><code>code</code></th></tr>',
        '</thead>',
        '<tbody>',
        '<tr><td><a href="https://example.com">link</a></td><td>a</td><td>b</td></tr>',
        '</tbody>',
        '</table>',
      ),
    )
  })

  it('applies column alignment classes', () => {
    const source = ['| l | c | r |', '| :--- | :---: | ---: |', '| a | b | c |'].join('\n')
    assert.equal(
      renderMarkdown(source),
      tableHtml(
        '<table>',
        '<thead>',
        '<tr><th class="align-left">l</th><th class="align-center">c</th><th class="align-right">r</th></tr>',
        '</thead>',
        '<tbody>',
        '<tr><td class="align-left">a</td><td class="align-center">b</td><td class="align-right">c</td></tr>',
        '</tbody>',
        '</table>',
      ),
    )
  })

  it('pads short rows and drops extra cells', () => {
    const source = ['| a | b | c |', '| --- | --- | --- |', '| 1 | 2 |', '| 1 | 2 | 3 | 4 |'].join(
      '\n',
    )
    assert.equal(
      renderMarkdown(source),
      tableHtml(
        '<table>',
        '<thead>',
        '<tr><th>a</th><th>b</th><th>c</th></tr>',
        '</thead>',
        '<tbody>',
        '<tr><td>1</td><td>2</td><td></td></tr>',
        '<tr><td>1</td><td>2</td><td>3</td></tr>',
        '</tbody>',
        '</table>',
      ),
    )
  })

  it('omits tbody when there are no data rows', () => {
    assert.equal(
      renderMarkdown('| a | b |\n| --- | --- |'),
      tableHtml('<table>', '<thead>', '<tr><th>a</th><th>b</th></tr>', '</thead>', '</table>'),
    )
  })

  it('starts a new table after a blank line', () => {
    const source = ['| a |', '| --- |', '| 1 |', '', '| b |', '| --- |', '| 2 |'].join('\n')
    assert.equal(
      renderMarkdown(source),
      [
        tableHtml(
          '<table>',
          '<thead>',
          '<tr><th>a</th></tr>',
          '</thead>',
          '<tbody>',
          '<tr><td>1</td></tr>',
          '</tbody>',
          '</table>',
        ),
        tableHtml(
          '<table>',
          '<thead>',
          '<tr><th>b</th></tr>',
          '</thead>',
          '<tbody>',
          '<tr><td>2</td></tr>',
          '</tbody>',
          '</table>',
        ),
      ].join('\n'),
    )
  })

  it('does not treat a mismatched delimiter as a table', () => {
    assert.equal(renderMarkdown('| a | b |\n| --- |'), '<p>| a | b | | --- |</p>')
  })

  it('interrupts a paragraph when the next lines are a table', () => {
    const source = ['導入です。', '| a | b |', '| --- | --- |', '| c | d |'].join('\n')
    assert.equal(
      renderMarkdown(source),
      [
        '<p>導入です。</p>',
        tableHtml(
          '<table>',
          '<thead>',
          '<tr><th>a</th><th>b</th></tr>',
          '</thead>',
          '<tbody>',
          '<tr><td>c</td><td>d</td></tr>',
          '</tbody>',
          '</table>',
        ),
      ].join('\n'),
    )
  })

  it('stops the body at a following list, heading, or rule', () => {
    assert.equal(
      renderMarkdown('| a |\n| --- |\n| b |\n- item'),
      [
        tableHtml(
          '<table>',
          '<thead>',
          '<tr><th>a</th></tr>',
          '</thead>',
          '<tbody>',
          '<tr><td>b</td></tr>',
          '</tbody>',
          '</table>',
        ),
        '<ul>',
        '<li>item</li>',
        '</ul>',
      ].join('\n'),
    )
    assert.equal(
      renderMarkdown('| a |\n| --- |\n# Next'),
      `${tableHtml('<table>', '<thead>', '<tr><th>a</th></tr>', '</thead>', '</table>')}\n<h1>Next</h1>`,
    )
    assert.equal(
      renderMarkdown('| a |\n| --- |\n| b |\n1. item'),
      [
        tableHtml(
          '<table>',
          '<thead>',
          '<tr><th>a</th></tr>',
          '</thead>',
          '<tbody>',
          '<tr><td>b</td></tr>',
          '</tbody>',
          '</table>',
        ),
        '<ol>',
        '<li>item</li>',
        '</ol>',
      ].join('\n'),
    )
    assert.equal(
      renderMarkdown('| a |\n| --- |\n```\ncode\n```'),
      `${tableHtml('<table>', '<thead>', '<tr><th>a</th></tr>', '</thead>', '</table>')}\n<pre><code>code</code></pre>`,
    )
    assert.equal(
      renderMarkdown('| a |\n| --- |\n> quoted'),
      [
        tableHtml('<table>', '<thead>', '<tr><th>a</th></tr>', '</thead>', '</table>'),
        '<blockquote>',
        '<p>quoted</p>',
        '</blockquote>',
      ].join('\n'),
    )
  })

  it('renders a table inside a blockquote', () => {
    const source = ['> | a | b |', '> | --- | --- |', '> | c | d |'].join('\n')
    assert.equal(
      renderMarkdown(source),
      [
        '<blockquote>',
        tableHtml(
          '<table>',
          '<thead>',
          '<tr><th>a</th><th>b</th></tr>',
          '</thead>',
          '<tbody>',
          '<tr><td>c</td><td>d</td></tr>',
          '</tbody>',
          '</table>',
        ),
        '</blockquote>',
      ].join('\n'),
    )
  })

  it('keeps a list row that starts with - when the cell has a leading pipe', () => {
    const source = ['| a | b |', '| --- | --- |', '| - item | x |'].join('\n')
    assert.equal(
      renderMarkdown(source),
      tableHtml(
        '<table>',
        '<thead>',
        '<tr><th>a</th><th>b</th></tr>',
        '</thead>',
        '<tbody>',
        '<tr><td>- item</td><td>x</td></tr>',
        '</tbody>',
        '</table>',
      ),
    )
  })

  it('escapes HTML in cells', () => {
    assert.equal(
      renderMarkdown('| <script> |\n| --- |\n| & |'),
      tableHtml(
        '<table>',
        '<thead>',
        '<tr><th>&lt;script&gt;</th></tr>',
        '</thead>',
        '<tbody>',
        '<tr><td>&amp;</td></tr>',
        '</tbody>',
        '</table>',
      ),
    )
  })
})

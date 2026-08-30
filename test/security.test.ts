import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { renderMarkdown } from '../src/markdown/render.js'
import { renderDocument } from '../src/typesetting/render-page.js'

describe('HTML escape', () => {
  it('escapes raw HTML in a paragraph', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    assert.equal(html.includes('<script>'), false)
    assert.equal(html.includes('</script>'), false)
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  it('escapes raw HTML in a complete document', () => {
    const html = renderDocument(renderMarkdown('<script>alert(1)</script>'))
    assert.equal(/<script\b/i.test(html), false)
  })

  it('escapes raw HTML inside a code block', () => {
    const source = ['```', '<script>alert(1)</script>', '```'].join('\n')
    const html = renderMarkdown(source)
    assert.equal(html.includes('<script>'), false)
    assert.match(html, /&lt;script&gt;/)
  })
})

// href に入った値だけを取り出します。括弧を含む URL はそもそもリンクに
// ならず、`javascript:alert(1)` は地の文として（エスケープされた文字として）
// 残ります。危ないのは href に入ることなので、そこだけを見ます。
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '')
}

function srcs(html: string): string[] {
  return [...html.matchAll(/src="([^"]*)"/g)].map((match) => match[1] ?? '')
}

describe('unsafe URL rejection', () => {
  it('rejects javascript: URLs', () => {
    assert.deepEqual(hrefs(renderMarkdown('[x](javascript:alert1)')), ['#'])
    // 括弧つきはリンクにならないので、href そのものが生まれない。
    const html = renderMarkdown('[x](javascript:alert(1))')
    assert.deepEqual(hrefs(html), [])
    assert.equal(html.includes('<a '), false)
  })

  it('rejects javascript: URLs regardless of case', () => {
    assert.deepEqual(hrefs(renderMarkdown('[x](JavaScript:alert1)')), ['#'])
    assert.deepEqual(hrefs(renderMarkdown('[x](JavaScript:alert(1))')), [])
  })

  it('rejects data: URLs', () => {
    const html = renderMarkdown('[x](data:text/html,hello)')
    assert.deepEqual(hrefs(html), ['#'])
    assert.equal(html.toLowerCase().includes('href="data:'), false)
  })

  it('rejects vbscript: URLs', () => {
    assert.deepEqual(hrefs(renderMarkdown('[x](vbscript:msgbox1)')), ['#'])
    assert.deepEqual(hrefs(renderMarkdown('[x](vbscript:msgbox(1))')), [])
  })

  it('escapes quotes in a URL attribute', () => {
    const html = renderMarkdown('[x](https://example.com/"onclick="alert)')
    assert.equal(html.includes('onclick="'), false)
    assert.match(html, /href="https:\/\/example.com\/&quot;onclick=&quot;alert"/)
  })

  it('rejects URLs that contain control characters', () => {
    const html = renderMarkdown('[x](https://example.com/\u0000evil)')
    assert.match(html, /href="#"/)
  })
})

describe('unsafe image URL rejection', () => {
  it('rejects javascript: image URLs', () => {
    assert.deepEqual(srcs(renderMarkdown('![x](javascript:alert1)')), ['#'])
    assert.equal(renderMarkdown('![x](javascript:alert1)').includes('javascript:'), false)
  })

  it('rejects mailto: image URLs', () => {
    assert.deepEqual(srcs(renderMarkdown('![x](mailto:a@b)')), ['#'])
  })

  it('escapes alt text', () => {
    const html = renderMarkdown('![<script>](a.png)')
    assert.equal(html.includes('<script>'), false)
    assert.equal(html, '<p><img src="a.png" alt="&lt;script&gt;"></p>')
  })

  it('does not emit a raw img tag from the manuscript', () => {
    const html = renderMarkdown('<img src="x">')
    assert.equal(html.includes('<img'), false)
    assert.match(html, /&lt;img src=&quot;x&quot;&gt;/)
  })
})

describe('control characters in the manuscript', () => {
  const SENTINEL = String.fromCharCode(0x01)

  it('does not let the hard-break sentinel become a raw <br>', () => {
    const html = renderMarkdown(`a${SENTINEL}b`)
    assert.equal(html.includes('<br>'), false)
    assert.equal(html, '<p>ab</p>')
  })

  it('does not let the sentinel escape a code span', () => {
    const html = renderMarkdown(`\`a${SENTINEL}b\``)
    assert.equal(html.includes('<br>'), false)
    assert.equal(html, '<p><code>ab</code></p>')
  })

  it('drops the sentinel inside a fenced code block', () => {
    const html = renderMarkdown(['```', `a${SENTINEL}b`, '```'].join('\n'))
    assert.equal(html.includes('<br>'), false)
    assert.equal(html, '<pre><code>ab</code></pre>')
  })

  it('still renders a real hard break', () => {
    const html = renderMarkdown('a  \nb')
    assert.equal(html, '<p>a<br>b</p>')
  })
})

describe('nested blockquote depth', () => {
  it('does not overflow the stack on deeply nested quotes', () => {
    const html = renderMarkdown(`${'>'.repeat(50000)} hi`)
    assert.equal(html.startsWith('<blockquote>'), true)
    assert.equal(html.includes('hi'), true)
  })

  it('escapes the remaining markers once the depth limit is reached', () => {
    const html = renderMarkdown(`${'>'.repeat(40)} <b>hi</b>`)
    assert.equal(html.includes('<b>'), false)
    assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/)
  })

  it('still nests quotes below the limit', () => {
    const html = renderMarkdown('>> hi')
    assert.equal(html, '<blockquote>\n<blockquote>\n<p>hi</p>\n</blockquote>\n</blockquote>')
  })
})

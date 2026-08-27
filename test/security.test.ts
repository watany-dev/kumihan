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

describe('unsafe URL rejection', () => {
  it('rejects javascript: URLs', () => {
    const html = renderMarkdown('[x](javascript:alert(1))')
    assert.equal(html.toLowerCase().includes('javascript:'), false)
    assert.match(html, /href="#"/)
  })

  it('rejects javascript: URLs regardless of case', () => {
    const html = renderMarkdown('[x](JavaScript:alert(1))')
    assert.equal(html.toLowerCase().includes('javascript:'), false)
  })

  it('rejects data: URLs', () => {
    const html = renderMarkdown('[x](data:text/html,hello)')
    assert.equal(html.toLowerCase().includes('data:'), false)
    assert.match(html, /href="#"/)
  })

  it('rejects vbscript: URLs', () => {
    const html = renderMarkdown('[x](vbscript:msgbox(1))')
    assert.equal(html.toLowerCase().includes('vbscript:'), false)
    assert.match(html, /href="#"/)
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

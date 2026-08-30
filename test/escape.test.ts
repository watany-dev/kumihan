import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { escapeHtml, sanitizeImageUrl, sanitizeUrl } from '../src/markdown/escape.js'

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;')
  })
})

describe('sanitizeUrl', () => {
  it('rejects an empty URL', () => {
    assert.equal(sanitizeUrl(''), '#')
    assert.equal(sanitizeUrl('   '), '#')
  })

  it('allows http, https, mailto, relative, and fragment URLs', () => {
    assert.equal(sanitizeUrl('https://example.com'), 'https://example.com')
    assert.equal(sanitizeUrl('http://example.com'), 'http://example.com')
    assert.equal(sanitizeUrl('mailto:a@example.com'), 'mailto:a@example.com')
    assert.equal(sanitizeUrl('./page.html'), './page.html')
    assert.equal(sanitizeUrl('#heading'), '#heading')
  })

  it('rejects javascript, data, and vbscript schemes', () => {
    assert.equal(sanitizeUrl('javascript:alert(1)'), '#')
    assert.equal(sanitizeUrl(' data:text/html,x '), '#')
    assert.equal(sanitizeUrl('vbscript:msgbox(1)'), '#')
  })

  it('does not let whitespace hide a scheme', () => {
    // 本文からのリンクは空白を含む URL をそもそも作りませんが、
    // sanitizeUrl 自体は最後の砦なので、空白を詰めてから判定します。
    assert.equal(sanitizeUrl('java script:alert(1)'), '#')
    assert.equal(sanitizeUrl('java\u00a0script:x'), '#')
    assert.equal(sanitizeUrl('https://example.com/a b'), 'https://example.com/a b')
  })

  it('rejects URLs that contain C0 controls including DEL', () => {
    assert.equal(sanitizeUrl('https://example.com/\u0001x'), '#')
    assert.equal(sanitizeUrl(`https://example.com/${String.fromCharCode(0x7f)}`), '#')
  })
})

describe('sanitizeImageUrl', () => {
  it('allows http, https, and relative URLs', () => {
    assert.equal(sanitizeImageUrl('https://example.com/a.png'), 'https://example.com/a.png')
    assert.equal(sanitizeImageUrl('http://example.com/a.png'), 'http://example.com/a.png')
    assert.equal(sanitizeImageUrl('./a.png'), './a.png')
    assert.equal(sanitizeImageUrl('a.png'), 'a.png')
  })

  it('rejects mailto, fragments, and unsafe schemes', () => {
    assert.equal(sanitizeImageUrl('mailto:a@b'), '#')
    assert.equal(sanitizeImageUrl('#heading'), '#')
    assert.equal(sanitizeImageUrl('javascript:alert(1)'), '#')
    assert.equal(sanitizeImageUrl('data:image/png,x'), '#')
    assert.equal(sanitizeImageUrl(''), '#')
  })
})

describe('escapeHtml fast path', () => {
  it('returns text without escapable characters unchanged', () => {
    const plain = '組版された本文 — no markup here.'
    assert.equal(escapeHtml(plain), plain)
    assert.equal(escapeHtml(''), '')
  })

  it('escapes every escapable character in one pass', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;')
  })

  it('does not double-escape the ampersands it introduces', () => {
    assert.equal(escapeHtml('<a & b>'), '&lt;a &amp; b&gt;')
  })
})

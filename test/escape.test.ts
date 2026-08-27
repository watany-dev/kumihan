import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { escapeHtml, sanitizeUrl } from '../src/markdown/escape.js'

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

  it('rejects URLs that contain C0 controls including DEL', () => {
    assert.equal(sanitizeUrl('https://example.com/\u0001x'), '#')
    assert.equal(sanitizeUrl(`https://example.com/${String.fromCharCode(0x7f)}`), '#')
  })
})

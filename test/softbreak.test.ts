import assert from 'node:assert/strict'
import { describe, it } from 'vite-plus/test'
import { renderMarkdown } from '../src/markdown/render.js'

describe('soft line breaks', () => {
  it('does not insert a space between Japanese lines', () => {
    const html = renderMarkdown('これは日本語\nの文章です。')
    assert.equal(html, '<p>これは日本語の文章です。</p>')
  })

  it('inserts a space between English lines', () => {
    const html = renderMarkdown('This is\nEnglish.')
    assert.equal(html, '<p>This is English.</p>')
  })

  it('treats trailing two spaces as a hard line break', () => {
    const html = renderMarkdown('上の行  \n下の行')
    assert.equal(html, '<p>上の行<br>下の行</p>')
  })

  it('does not insert a space when a Japanese line meets Latin text', () => {
    const html = renderMarkdown('日本語\nABC')
    assert.equal(html, '<p>日本語ABC</p>')
  })
})

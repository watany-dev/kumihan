import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { magazineCss } from '../src/typesetting/magazine.css.js'
import { resolvePreviewMode } from '../src/typesetting/render-page.js'

describe('magazine stylesheet', () => {
  it('uses B5 paper and two columns', () => {
    assert.match(magazineCss, /size:\s*B5/)
    assert.match(magazineCss, /column-count:\s*2/)
    assert.match(magazineCss, /width:\s*182mm/)
    assert.match(magazineCss, /min-height:\s*257mm/)
  })

  it('keeps titles and code out of a single column', () => {
    assert.match(magazineCss, /h1 \+ p/)
    assert.match(magazineCss, /column-span: all/)
    assert.match(magazineCss, /\.magazine-typeset pre,\n\.feature-typeset pre \{/)
  })

  it('styles quotes as magazine callouts', () => {
    assert.match(magazineCss, /content: "NOTE"/)
    assert.match(magazineCss, /content: "POINT"/)
  })
})

describe('resolvePreviewMode', () => {
  it('keeps known modes', () => {
    assert.equal(resolvePreviewMode('print'), 'print')
    assert.equal(resolvePreviewMode('magazine'), 'magazine')
    assert.equal(resolvePreviewMode('feature'), 'feature')
    assert.equal(resolvePreviewMode('web'), 'web')
  })

  it('defaults missing modes to print', () => {
    assert.equal(resolvePreviewMode(undefined), 'print')
    assert.equal(resolvePreviewMode('leaflet'), 'print')
  })
})

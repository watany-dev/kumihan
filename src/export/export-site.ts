import { renderMarkdown } from '../markdown/render.js'
import { magazineCss } from '../typesetting/magazine.css.js'
import {
  renderDocument,
  type PreviewMode,
  type RenderDocumentOptions,
} from '../typesetting/render-page.js'
import { typesetCss } from '../typesetting/typeset.css.js'
import { webCss } from '../typesetting/web.css.js'

export interface StaticAsset {
  pathname: string
  response: Response
}

const HTML_TYPE = { 'Content-Type': 'text/html; charset=utf-8' }
const CSS_TYPE = { 'Content-Type': 'text/css; charset=utf-8' }

export function exportSite(markdown: string, options?: RenderDocumentOptions): StaticAsset[] {
  const fragment = renderMarkdown(markdown)
  const documentOptions = { ...options }

  return [
    htmlAsset('/index.html', fragment, documentOptions, 'print'),
    htmlAsset('/magazine.html', fragment, documentOptions, 'magazine'),
    htmlAsset('/feature.html', fragment, documentOptions, 'feature'),
    htmlAsset('/web.html', fragment, documentOptions, 'web'),
    {
      pathname: '/assets/typeset.css',
      response: new Response(typesetCss, { headers: CSS_TYPE }),
    },
    {
      pathname: '/assets/magazine.css',
      response: new Response(magazineCss, { headers: CSS_TYPE }),
    },
    {
      pathname: '/assets/web.css',
      response: new Response(webCss, { headers: CSS_TYPE }),
    },
  ]
}

function htmlAsset(
  pathname: string,
  fragment: string,
  options: RenderDocumentOptions,
  mode: PreviewMode,
): StaticAsset {
  return {
    pathname,
    response: new Response(renderDocument(fragment, { ...options, mode }), {
      headers: HTML_TYPE,
    }),
  }
}

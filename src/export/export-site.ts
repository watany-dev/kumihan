import { renderMarkdown } from '../markdown/render.js'
import { renderDocument, type RenderDocumentOptions } from '../typesetting/render-page.js'
import { typesetCss } from '../typesetting/typeset.css.js'

export interface StaticAsset {
  pathname: string
  response: Response
}

export function exportSite(
  markdown: string,
  options?: RenderDocumentOptions,
): StaticAsset[] {
  const html = renderDocument(renderMarkdown(markdown), options)

  return [
    {
      pathname: '/index.html',
      response: new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }),
    },
    {
      pathname: '/assets/typeset.css',
      response: new Response(typesetCss, {
        headers: {
          'Content-Type': 'text/css; charset=utf-8',
        },
      }),
    },
  ]
}

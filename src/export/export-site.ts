import { renderMarkdown } from '../markdown/render.js'
import { renderDocument, type RenderDocumentOptions } from '../typesetting/render-page.js'
import { typesetCss } from '../typesetting/typeset.css.js'
import { webCss } from '../typesetting/web.css.js'

export interface StaticAsset {
  pathname: string
  response: Response
}

export function exportSite(markdown: string, options?: RenderDocumentOptions): StaticAsset[] {
  const fragment = renderMarkdown(markdown)
  const printHtml = renderDocument(fragment, { ...options, mode: 'print' })
  const webHtml = renderDocument(fragment, { ...options, mode: 'web' })

  return [
    {
      pathname: '/index.html',
      response: new Response(printHtml, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }),
    },
    {
      pathname: '/web.html',
      response: new Response(webHtml, {
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
    {
      pathname: '/assets/web.css',
      response: new Response(webCss, {
        headers: {
          'Content-Type': 'text/css; charset=utf-8',
        },
      }),
    },
  ]
}

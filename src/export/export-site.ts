import { renderMarkdown } from '../markdown/render.js'
import { renderDocument, type RenderDocumentOptions } from '../typesetting/render-page.js'
import { typesetCss } from '../typesetting/typeset.css.js'
import { webCss } from '../typesetting/web.css.js'

export interface StaticAsset {
  pathname: string
  response: Response
}

/** 書き出す 1 ファイル。本文は文字列のまま持ちます。 */
export interface ExportFile {
  pathname: string
  body: string
  contentType: string
}

const HTML_TYPE = 'text/html; charset=utf-8'
const CSS_TYPE = 'text/css; charset=utf-8'

/**
 * 変換済みの断片（renderMarkdown の結果）から、書き出す一式を作ります。
 *
 * 断片を受け取るのは、呼び出し側が断片を他の用途（writeExport の画像収集）
 * にも使うためです。Markdown の変換は書き出し全体で最も重い段階なので、
 * ここでもう一度やり直さないことが効きます。
 */
export function exportFiles(fragment: string, options?: RenderDocumentOptions): ExportFile[] {
  return [
    {
      pathname: '/index.html',
      body: renderDocument(fragment, { ...options, mode: 'print' }),
      contentType: HTML_TYPE,
    },
    {
      pathname: '/magazine.html',
      body: renderDocument(fragment, { ...options, mode: 'magazine' }),
      contentType: HTML_TYPE,
    },
    {
      pathname: '/web.html',
      body: renderDocument(fragment, { ...options, mode: 'web' }),
      contentType: HTML_TYPE,
    },
    {
      pathname: '/assets/typeset.css',
      body: typesetCss,
      contentType: CSS_TYPE,
    },
    {
      pathname: '/assets/web.css',
      body: webCss,
      contentType: CSS_TYPE,
    },
  ]
}

export function exportSite(markdown: string, options?: RenderDocumentOptions): StaticAsset[] {
  return exportFiles(renderMarkdown(markdown), options).map((file) => ({
    pathname: file.pathname,
    response: new Response(file.body, {
      headers: {
        'Content-Type': file.contentType,
      },
    }),
  }))
}

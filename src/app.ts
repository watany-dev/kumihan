import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { renderMarkdown } from './markdown/render.js'
import {
  DEFAULT_LANGUAGE,
  DEFAULT_TITLE,
  renderDocument,
} from './typesetting/render-page.js'
import { typesetCss } from './typesetting/typeset.css.js'

export interface PreviewConfig {
  source: string
  title?: string
  language?: string
}

const DEFAULT_SOURCE = './content/index.md'

export function createPreviewApp(config: PreviewConfig = { source: DEFAULT_SOURCE }): Hono {
  const source = config.source || DEFAULT_SOURCE
  const title = config.title ?? DEFAULT_TITLE
  const language = config.language ?? DEFAULT_LANGUAGE
  const sourcePath = resolve(source)

  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true }))

  app.get('/assets/typeset.css', (c) =>
    c.body(typesetCss, 200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-store',
    }),
  )

  app.get('/', async (c) => {
    try {
      const markdown = await readFile(sourcePath, 'utf8')
      const html = renderDocument(renderMarkdown(markdown), { title, language })
      return c.body(html, 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      })
    } catch (error) {
      if (isNotFound(error)) {
        return c.html(errorPage(404, '原稿が見つかりません', '指定された Markdown ファイルが存在しません。'), 404)
      }

      console.error('[kumihan] Failed to read markdown source:', error)
      return c.html(
        errorPage(500, '読み込みに失敗しました', 'Markdown ファイルの読み込み中にエラーが発生しました。'),
        500,
      )
    }
  })

  return app
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT',
  )
}

function errorPage(status: number, heading: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${heading}</title>
  <style>
    body { font-family: sans-serif; margin: 12vh auto; max-width: 36em; line-height: 1.7; color: #222; }
    p { color: #555; }
  </style>
</head>
<body>
  <h1>${status} ${heading}</h1>
  <p>${message}</p>
</body>
</html>
`
}

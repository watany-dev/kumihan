import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { Hono, type Context } from 'hono'

import { imageContentType, resolveManuscriptFile } from './manuscript-path.js'
import { renderMarkdown } from './markdown/render.js'
import { documentSecurityMeta, previewSecureHeaders } from './security/headers.js'
import { renderDocument, type PreviewMode } from './typesetting/render-page.js'
import { typesetCss } from './typesetting/typeset.css.js'
import { webCss } from './typesetting/web.css.js'

export interface PreviewConfig {
  source: string
  title?: string
  language?: string
}

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  // ponytail: full-page Refresh every 2s. EventSource if scroll must stick.
  Refresh: '2',
} as const

const CSS_HEADERS = {
  'Content-Type': 'text/css; charset=utf-8',
  'Cache-Control': 'no-store',
} as const

const IMAGE_HEADERS = {
  'Cache-Control': 'no-store',
} as const

export function createPreviewApp(config: PreviewConfig = { source: './content/index.md' }): Hono {
  const title = config.title ?? 'Typeset Preview'
  const language = config.language ?? 'ja'
  const root = dirname(resolve(config.source))
  const app = new Hono()
  app.use('*', previewSecureHeaders())

  app.get('/health', (c) => c.json({ ok: true }))

  app.get('/assets/typeset.css', (c) => c.body(typesetCss, 200, CSS_HEADERS))
  app.get('/assets/web.css', (c) => c.body(webCss, 200, CSS_HEADERS))

  app.get('/', (c) => serveManuscript(c, 'print'))
  app.get('/magazine.html', (c) => serveManuscript(c, 'magazine'))
  app.get('/magazine', (c) => serveManuscript(c, 'magazine'))
  app.get('/web.html', (c) => serveManuscript(c, 'web'))
  app.get('/web', (c) => serveManuscript(c, 'web'))

  app.get('/*', async (c) => {
    const rel = c.req.path.startsWith('/') ? c.req.path.slice(1) : c.req.path
    const file = await resolveManuscriptFile(root, rel)
    if (file === null) {
      return c.body('', 404)
    }
    const type = imageContentType(rel) ?? imageContentType(file)
    if (type === undefined) {
      return c.body('', 404)
    }
    try {
      return c.body(await readFile(file), 200, {
        ...IMAGE_HEADERS,
        'Content-Type': type,
      })
    } catch {
      return c.body('', 404)
    }
  })

  async function serveManuscript(c: Context, mode: PreviewMode) {
    try {
      const markdown = await readFile(config.source, 'utf8')
      const html = renderDocument(renderMarkdown(markdown), { title, language, mode })
      return c.body(html, 200, HTML_HEADERS)
    } catch (error) {
      if (isNotFound(error)) {
        return c.body(
          errorPage(404, '原稿が見つかりません', '指定された Markdown ファイルが存在しません。'),
          404,
          HTML_HEADERS,
        )
      }

      console.error('[kumihan] Failed to read markdown source:', error)
      return c.body(
        errorPage(
          500,
          '読み込みに失敗しました',
          'Markdown ファイルの読み込み中にエラーが発生しました。',
        ),
        500,
        HTML_HEADERS,
      )
    }
  }

  return app
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function errorPage(status: number, heading: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
${documentSecurityMeta()}
  <title>${heading}</title>
</head>
<body>
  <h1>${status} ${heading}</h1>
  <p>${message}</p>
</body>
</html>
`
}

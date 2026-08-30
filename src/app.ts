import { readFile } from 'node:fs/promises'

import { Hono, type Context } from 'hono'

import { imageContentType, resolveManuscriptFile } from './manuscript-path.js'
import { toManuscript, type ManuscriptSource } from './manuscript.js'
import { renderMarkdown } from './markdown/render.js'
import { documentSecurityMeta, previewSecureHeaders } from './security/headers.js'
import { renderDocument, type PreviewMode } from './typesetting/render-page.js'
import { typesetCss } from './typesetting/typeset.css.js'
import { webCss } from './typesetting/web.css.js'

export interface PreviewConfig {
  source: ManuscriptSource
  title?: string
  language?: string
}

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  // ponytail: full-page Refresh every 2s.
  //
  // スクロール位置はリロードを跨いで復元されます（Chromium で実測）。EventSource
  // が要るのはそこではなく、保存から表示までの遅れ（この間隔ぶん、平均 1 秒）を
  // 詰めたくなったときです。
  Refresh: '2',
} as const

const CSS_HEADERS = {
  'Content-Type': 'text/css; charset=utf-8',
  'Cache-Control': 'no-store',
} as const

export function createPreviewApp(config: PreviewConfig = { source: './content/index.md' }): Hono {
  const title = config.title ?? 'Typeset Preview'
  const language = config.language ?? 'ja'
  const manuscript = toManuscript(config.source)
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
    const rel = c.req.path.slice(1)
    const file = await resolveManuscriptFile(manuscript.root, rel)
    if (file === null) return c.body('', 404)
    const type = imageContentType(rel) ?? imageContentType(file)
    if (type === undefined) return c.body('', 404)
    try {
      return c.body(await readFile(file), 200, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
      })
    } catch {
      return c.body('', 404)
    }
  })

  // 原稿が変わらないかぎり、組んだ結果を使い回します。
  //
  // プレビューは Refresh で同じ原稿を繰り返し取りに来ます。開いているタブと
  // モードの数だけ、変わっていない原稿を毎回組み直していました（1MB の原稿で
  // 1 回 68ms）。原稿の中身が前回と同じかどうかだけで判定するので、mtime の
  // 粒度に頼らず、保存し直しただけのファイルも取り違えません。
  //
  // 中間の断片は 3 つのモードで共通です。モードを切り替えても Markdown の
  // 変換はやり直しません（変換は組み立ての 3 倍以上かかります）。
  let cachedMarkdown: string | null = null
  let cachedFragment = ''
  const cachedDocuments = new Map<PreviewMode, string>()

  function documentFor(markdown: string, mode: PreviewMode): string {
    if (markdown !== cachedMarkdown) {
      cachedMarkdown = markdown
      cachedFragment = renderMarkdown(markdown)
      cachedDocuments.clear()
    }

    const cached = cachedDocuments.get(mode)
    if (cached !== undefined) {
      return cached
    }

    const html = renderDocument(cachedFragment, { title, language, mode })
    cachedDocuments.set(mode, html)
    return html
  }

  async function serveManuscript(c: Context, mode: PreviewMode) {
    try {
      const markdown = await manuscript.read()
      const html = documentFor(markdown, mode)
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

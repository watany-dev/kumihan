import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { Hono, type Context } from 'hono'

import { imageContentType, resolveManuscriptFile } from './manuscript-path.js'
import { toManuscript, type ManuscriptSource } from './manuscript.js'
import { renderMarkdown } from './markdown/render.js'
import { reloadJs } from './reload.js.js'
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
} as const

const CSS_HEADERS = {
  'Content-Type': 'text/css; charset=utf-8',
  'Cache-Control': 'no-store',
} as const

const JS_HEADERS = {
  'Content-Type': 'text/javascript; charset=utf-8',
  'Cache-Control': 'no-store',
} as const

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-store',
} as const

// 保存イベントは 1 回の保存で連続して届くことがあるので、この幅で 1 回に
// まとめてから読み直します。保存から通知までの遅れに直接乗る値です。
const WATCH_SETTLE_MS = 15

// 転送路の途中（ポート転送やプロキシ）に無通信で切る装置がいても接続が
// 保つよう、この間隔で SSE のコメント行を流します。切れても EventSource が
// つなぎ直すので、これは切断を減らすための保険です。
const HEARTBEAT_MS = 30_000

export function createPreviewApp(config: PreviewConfig = { source: './content/index.md' }): Hono {
  const title = config.title ?? 'Typeset Preview'
  const language = config.language ?? 'ja'
  const manuscript = toManuscript(config.source)
  const app = new Hono()
  app.use('*', previewSecureHeaders())

  app.get('/health', (c) => c.json({ ok: true }))

  app.get('/assets/typeset.css', (c) => c.body(typesetCss, 200, CSS_HEADERS))
  app.get('/assets/web.css', (c) => c.body(webCss, 200, CSS_HEADERS))
  app.get('/assets/reload.js', (c) => c.body(reloadJs, 200, JS_HEADERS))

  app.get('/', (c) => serveManuscript(c, 'print'))
  app.get('/magazine.html', (c) => serveManuscript(c, 'magazine'))
  app.get('/magazine', (c) => serveManuscript(c, 'magazine'))
  app.get('/web.html', (c) => serveManuscript(c, 'web'))
  app.get('/web', (c) => serveManuscript(c, 'web'))

  // 原稿が変わらないかぎり、組んだ結果を使い回します。
  //
  // 別のタブやモードが同じ原稿を取りに来るたびに、変わっていない原稿を
  // 組み直すのは無駄です（1MB の原稿で 1 回 68ms）。原稿の中身が前回と
  // 同じかどうかだけで判定するので、mtime の粒度に頼らず、保存し直した
  // だけのファイルも取り違えません。
  //
  // 中間の断片は 3 つのモードで共通です。モードを切り替えても Markdown の
  // 変換はやり直しません（変換は組み立ての 3 倍以上かかります）。
  let cachedMarkdown: string | null = null
  let cachedFragment = ''
  let cachedVersion = ''
  const cachedDocuments = new Map<PreviewMode, string>()

  function prime(markdown: string): void {
    if (markdown === cachedMarkdown) return
    cachedMarkdown = markdown
    cachedFragment = renderMarkdown(markdown)
    cachedVersion = versionOf(markdown)
    cachedDocuments.clear()
  }

  function documentFor(markdown: string, mode: PreviewMode): string {
    prime(markdown)

    const cached = cachedDocuments.get(mode)
    if (cached !== undefined) {
      return cached
    }

    const html = renderDocument(cachedFragment, {
      title,
      language,
      mode,
      liveReload: cachedVersion,
    })
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

  // 保存されたことをプレビューへ知らせる口（SSE）。
  //
  // 以前は `Refresh: 2` でブラウザに 2 秒ごと取り直させていました。保存から
  // 表示まで平均 1 秒（最悪は間隔ぶんの 2 秒）待たされるうえ、何も変わって
  // いなくても全文の転送とパースが 2 秒ごとに走り続けます。原稿を監視して
  // 変わったときだけ知らせれば、待ちは監視の遅れと 1 回のリロードだけに
  // なり、変わらないあいだは何も流れません。
  //
  // 監視は購読者がいるあいだだけ動かします。ページはバージョン（原稿の
  // ハッシュ）を添えて接続してくるので、読み込みから接続までの間に保存が
  // 挟まっていたら、その場で知らせて取りこぼしを防ぎます。
  const subscribers = new Set<(version: string) => void>()
  let stopWatching: (() => void) | null = null
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let notifiedVersion: string | null = null

  async function currentVersion(): Promise<string> {
    try {
      return versionOf(await manuscript.read())
    } catch {
      // 原稿が無い・読めない間は「バージョン無し」。404 ページも空の
      // バージョンで接続してくるので、原稿が現れたときに知らせられます。
      return ''
    }
  }

  async function broadcastIfChanged(): Promise<void> {
    let markdown: string | null = null
    try {
      markdown = await manuscript.read()
    } catch {
      // 保存の瞬間はファイルが一時的に無いこともある。読めない間は
      // 「バージョン無し」として扱い、読めるようになったらまた知らせる。
    }
    const version = markdown === null ? '' : versionOf(markdown)
    if (version === notifiedVersion) return
    notifiedVersion = version
    for (const notify of subscribers) notify(version)
    // 知らせたブラウザはすぐ取りに来ます。先に知らせてから組んでおくと、
    // ブラウザがナビゲーションを始める裏で変換が済み、GET は組み上がった
    // キャッシュで返せます（1MB の原稿で 20ms ほど前倒しになります）。
    if (markdown !== null) prime(markdown)
  }

  function onWatchEvent(): void {
    // 保存の途中（一時ファイルへの書き込みと rename の連続）をまとめる。
    if (settleTimer !== null) return
    settleTimer = setTimeout(() => {
      settleTimer = null
      void broadcastIfChanged()
    }, WATCH_SETTLE_MS)
  }

  function subscribe(notify: (version: string) => void): void {
    subscribers.add(notify)
    if (stopWatching === null && manuscript.watch !== undefined) {
      stopWatching = manuscript.watch(onWatchEvent)
    }
  }

  function unsubscribe(notify: (version: string) => void): void {
    subscribers.delete(notify)
    if (subscribers.size > 0 || stopWatching === null) return
    stopWatching()
    stopWatching = null
    if (settleTimer !== null) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  }

  app.get('/events', async (c) => {
    const version = await currentVersion()
    notifiedVersion = version
    const clientVersion = c.req.query('v')

    const encoder = new TextEncoder()
    let notify: ((version: string) => void) | null = null
    let heartbeat: ReturnType<typeof setInterval> | null = null

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (payload: string) => {
          // 切断とほぼ同時のイベントは enqueue が例外になるだけなので握りつぶす。
          try {
            controller.enqueue(encoder.encode(payload))
          } catch {
            /* closed */
          }
        }
        const onSaved = (next: string) => send(`data: ${next}\n\n`)
        notify = onSaved
        subscribe(onSaved)
        send('retry: 500\n\n')
        heartbeat = setInterval(() => send(':\n\n'), HEARTBEAT_MS)
        // ページの読み込みから接続までの間に保存が挟まっていた場合。
        if (clientVersion !== undefined && clientVersion !== version) onSaved(version)
      },
      cancel() {
        if (notify !== null) unsubscribe(notify)
        if (heartbeat !== null) clearInterval(heartbeat)
      },
    })

    return c.body(stream, 200, SSE_HEADERS)
  })

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

  return app
}

function versionOf(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex').slice(0, 16)
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

// エラーページにも自動リロードを入れます。原稿が置かれた・直った瞬間に
// 本文へ切り替わります。バージョンは「無し」で接続するので、すでに原稿が
// 読める状態に戻っていれば、接続した時点でリロードがかかります。
function errorPage(status: number, heading: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
${documentSecurityMeta('preview')}
  <title>${heading}</title>
  <script src="assets/reload.js" data-kumihan-version="" defer></script>
  <noscript><meta http-equiv="refresh" content="2"></noscript>
</head>
<body>
  <h1>${status} ${heading}</h1>
  <p>${message}</p>
</body>
</html>
`
}

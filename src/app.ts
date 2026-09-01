import { readFile } from 'node:fs/promises'

import { Hono, type Context } from 'hono'

import { renderBlockDiff } from './diff/block-diff.js'
import { probeGit, readHeadFile, type GitTrackedFile } from './git-source.js'
import { imageContentType, resolveManuscriptFile } from './manuscript-path.js'
import { toManuscript, type ManuscriptSource } from './manuscript.js'
import { normalizeMarkdown, renderMarkdown, renderMarkdownPiece } from './markdown/render.js'
import { splitSegments } from './markdown/segments.js'
import { reloadJs } from './reload.js.js'
import { documentSecurityMeta, previewSecureHeaders } from './security/headers.js'
import { withImageSizes } from './typesetting/measure-images.js'
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
  app.get('/diff.html', (c) => serveDiff(c))
  app.get('/diff', (c) => serveDiff(c))

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

  // git の探りは createPreviewApp を同期のままにするため、初回の HTML 応答
  // で await して結果を覚える。プロセス中に有効/無効は変わらない。
  let gitProbe: Promise<GitTrackedFile | null> | undefined

  function gitSource(): Promise<GitTrackedFile | null> {
    gitProbe ??= (async () => {
      const file = manuscript.file
      if (file === undefined) return null
      return probeGit(file)
    })()
    return gitProbe
  }

  async function prime(markdown: string): Promise<void> {
    if (markdown === cachedMarkdown) return
    // 画像の実寸は原稿の画像ファイルから読みます（頁分けの見積りに要ります）。
    // ハッシュと同時に走らせるので、原稿 1 本ぶんの待ちはどちらか長いほうだけです。
    // await 明けに別のリクエストが同じ内容で先着していても、結果は同じ。
    const [version, fragment] = await Promise.all([
      versionOf(markdown),
      withImageSizes(renderMarkdown(markdown), manuscript.root),
    ])
    cachedMarkdown = markdown
    cachedFragment = fragment
    cachedVersion = version
    cachedDocuments.clear()
  }

  async function documentFor(markdown: string, mode: PreviewMode): Promise<string> {
    const [, git] = await Promise.all([prime(markdown), gitSource()])

    const cached = cachedDocuments.get(mode)
    if (cached !== undefined) {
      return cached
    }

    const html = renderDocument(cachedFragment, {
      title,
      language,
      mode,
      liveReload: cachedVersion,
      diffLink: git !== null,
    })
    cachedDocuments.set(mode, html)
    return html
  }

  const DIFF_UNAVAILABLE =
    '<p>この原稿では差分を表示できません。git リポジトリで追跡されているファイルを指定してください。</p>'

  let cachedDiffKey = ''
  let cachedDiffHtml = ''
  let cachedOldOid = ''
  const cachedOldPieces = new Map<string, string>()

  function renderDiffPiece(segment: string): string {
    const hit = cachedOldPieces.get(segment)
    if (hit !== undefined) return hit
    return renderMarkdownPiece(segment)
  }

  async function diffPage(markdown: string, git: GitTrackedFile): Promise<string | null> {
    const [version, head] = await Promise.all([versionOf(markdown), readHeadFile(git)])
    if (head === null) return null

    const key = `${head.oid}:${version}`
    if (key === cachedDiffKey) return cachedDiffHtml

    if (head.oid !== cachedOldOid) {
      cachedOldPieces.clear()
      cachedOldOid = head.oid
    }
    for (const segment of splitSegments(normalizeMarkdown(head.text))) {
      if (!cachedOldPieces.has(segment)) {
        cachedOldPieces.set(segment, renderMarkdownPiece(segment))
      }
    }

    const fragment = renderBlockDiff(
      normalizeMarkdown(head.text),
      normalizeMarkdown(markdown),
      renderDiffPiece,
    )
    const sized = await withImageSizes(fragment, manuscript.root)
    const html = renderDocument(sized, {
      title,
      language,
      mode: 'web',
      liveReload: version,
      diffLink: true,
      diffActive: true,
    })
    cachedDiffKey = key
    cachedDiffHtml = html
    return html
  }

  async function unavailableDiffPage(markdown: string, diffLink: boolean): Promise<string> {
    return renderDocument(DIFF_UNAVAILABLE, {
      title,
      language,
      mode: 'web',
      liveReload: await versionOf(markdown),
      diffLink,
    })
  }

  function manuscriptReadError(c: Context, error: unknown) {
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

  async function serveManuscript(c: Context, mode: PreviewMode) {
    try {
      const markdown = await manuscript.read()
      const html = await documentFor(markdown, mode)
      return c.body(html, 200, HTML_HEADERS)
    } catch (error) {
      return manuscriptReadError(c, error)
    }
  }

  async function serveDiff(c: Context) {
    let markdown: string
    try {
      markdown = await manuscript.read()
    } catch (error) {
      return manuscriptReadError(c, error)
    }

    const git = await gitSource()
    if (git === null) {
      return c.body(await unavailableDiffPage(markdown, false), 200, HTML_HEADERS)
    }

    const html = await diffPage(markdown, git)
    if (html === null) {
      return c.body(await unavailableDiffPage(markdown, true), 200, HTML_HEADERS)
    }
    return c.body(html, 200, HTML_HEADERS)
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
      return await versionOf(await manuscript.read())
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
    const version = markdown === null ? '' : await versionOf(markdown)
    if (version === notifiedVersion) return
    notifiedVersion = version
    for (const notify of subscribers) notify(version)
    // 知らせたブラウザはすぐ取りに来ます。先に知らせてから組んでおくと、
    // ブラウザがナビゲーションを始める裏で変換が済み、GET は組み上がった
    // キャッシュで返せます（1MB の原稿で 20ms ほど前倒しになります）。
    if (markdown !== null) await prime(markdown)
  }

  function onWatchEvent(): void {
    // 保存の途中（一時ファイルへの書き込みと rename の連続）をまとめる。
    if (settleTimer !== null) return
    settleTimer = setTimeout(() => {
      settleTimer = null
      // serveManuscript と違って catch する枠が無い経路。変換が万一投げても
      // 未処理 rejection でプレビューごと落とさず、記録だけして生かしておく。
      broadcastIfChanged().catch((error: unknown) => {
        console.error('[kumihan] Failed to broadcast a manuscript change:', error)
      })
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

// Web Crypto（globalThis.crypto）。改ざん耐性は要らず、内容が変わったことが
// 分かればよいので、先頭 8 バイトの 16 進で十分です。
async function versionOf(markdown: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(markdown))
  let version = ''
  for (const byte of new Uint8Array(digest, 0, 8)) {
    version += byte.toString(16).padStart(2, '0')
  }
  return version
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

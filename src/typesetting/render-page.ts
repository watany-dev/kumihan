import { escapeHtml } from '../markdown/escape.js'
import { documentSecurityMeta } from '../security/headers.js'
import { MAGAZINE_LAYOUT, PRINT_LAYOUT, paginate } from './paginate.js'

export type PreviewMode = 'print' | 'magazine' | 'web'

export interface RenderDocumentOptions {
  title?: string
  language?: string
  mode?: PreviewMode
  /**
   * プレビューの自動リロードを埋める。値は原稿のバージョン（内容のハッシュ）で、
   * ブラウザはこれを添えて `/events` につなぐ。export では渡さないので、
   * 静的 HTML にはスクリプトが入らず、CSP も `script-src 'none'` のまま。
   */
  liveReload?: string
}

export function renderDocument(html: string, options?: RenderDocumentOptions): string {
  const title = escapeHtml(options?.title ?? 'Typeset Preview')
  const language = escapeHtml(options?.language ?? 'ja')
  const mode: PreviewMode =
    options?.mode === 'web' || options?.mode === 'magazine' ? options.mode : 'print'
  const stylesheet = mode === 'web' ? 'assets/web.css' : 'assets/typeset.css'
  const viewport =
    mode === 'web' ? '  <meta name="viewport" content="width=device-width, initial-scale=1">\n' : ''
  const liveReload = options?.liveReload

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
${viewport}${documentSecurityMeta(liveReload === undefined ? 'export' : 'preview')}
  <title>${title}</title>
  <link rel="stylesheet" href="${stylesheet}">
${liveReload === undefined ? '' : liveReloadHead(liveReload)}</head>
${renderBody(html, mode)}
</html>
`
}

// スクリプトが動かないブラウザでは、以前と同じ 2 秒間隔の再読み込みに戻す。
function liveReloadHead(version: string): string {
  return `  <script src="assets/reload.js" data-kumihan-version="${escapeHtml(version)}" defer></script>
  <noscript><meta http-equiv="refresh" content="2"></noscript>
`
}

function renderBody(html: string, mode: PreviewMode): string {
  if (mode === 'web') {
    return `<body class="web">
  <header class="site-header">
    <div class="site-header-inner">
      <p class="site-brand">kumihan</p>
      ${modeSwitcher(mode)}
    </div>
  </header>
  <main class="article-shell">
    <article class="article">
${html}
    </article>
  </main>
</body>`
  }

  if (mode === 'magazine') {
    return `<body>
  ${modeSwitcher(mode)}
${renderPapers(paginate(html, MAGAZINE_LAYOUT), 'typeset cols-2')}
</body>`
  }

  return `<body>
  ${modeSwitcher(mode)}
${renderPapers(paginate(html, PRINT_LAYOUT), 'typeset')}
</body>`
}

function renderPapers(pages: string[], articleClass: string): string {
  return pages
    .map(
      (page) => `  <div class="paper">
    <article class="${articleClass}">
${page}
    </article>
  </div>`,
    )
    .join('\n')
}

function modeSwitcher(mode: PreviewMode): string {
  const printActive = mode === 'print'
  const magazineActive = mode === 'magazine'
  const webActive = mode === 'web'

  return `<nav class="mode-switch" aria-label="表示モード">
    <a class="mode-switch-link${printActive ? ' is-active' : ''}" href="./"${printActive ? ' aria-current="page"' : ''}>組版</a>
    <a class="mode-switch-link${magazineActive ? ' is-active' : ''}" href="magazine.html"${magazineActive ? ' aria-current="page"' : ''}>2段</a>
    <a class="mode-switch-link${webActive ? ' is-active' : ''}" href="web.html"${webActive ? ' aria-current="page"' : ''}>Web</a>
  </nav>`
}

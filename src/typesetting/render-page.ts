import { escapeHtml } from '../markdown/escape.js'
import { documentSecurityMeta } from '../security/headers.js'

export type PreviewMode = 'print' | 'magazine' | 'feature' | 'web'

export interface RenderDocumentOptions {
  title?: string
  language?: string
  mode?: PreviewMode
}

const PREVIEW_LINKS: ReadonlyArray<{ id: PreviewMode; href: string; label: string }> = [
  { id: 'print', href: './', label: '組版' },
  { id: 'magazine', href: 'magazine.html', label: '2段' },
  { id: 'feature', href: 'feature.html', label: '特集' },
  { id: 'web', href: 'web.html', label: 'Web' },
]

export function renderDocument(html: string, options?: RenderDocumentOptions): string {
  const title = escapeHtml(options?.title ?? 'Typeset Preview')
  const language = escapeHtml(options?.language ?? 'ja')
  const mode = resolvePreviewMode(options?.mode)
  const stylesheet = stylesheetFor(mode)
  const viewport =
    mode === 'web' ? '  <meta name="viewport" content="width=device-width, initial-scale=1">\n' : ''

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
${viewport}${documentSecurityMeta()}
  <title>${title}</title>
  <link rel="stylesheet" href="${stylesheet}">
</head>
${renderBody(html, mode)}
</html>
`
}

export function resolvePreviewMode(mode: string | undefined): PreviewMode {
  if (mode === 'web' || mode === 'magazine' || mode === 'feature' || mode === 'print') {
    return mode
  }
  return 'print'
}

function stylesheetFor(mode: PreviewMode): string {
  if (mode === 'web') {
    return 'assets/web.css'
  }
  if (mode === 'magazine' || mode === 'feature') {
    return 'assets/magazine.css'
  }
  return 'assets/typeset.css'
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
    return `<body class="magazine">
  ${modeSwitcher(mode)}
  <div class="paper magazine-sheet">
    <header class="masthead">
      <p class="masthead-mark">kumihan</p>
      <p class="masthead-label">2段組</p>
    </header>
    <article class="typeset magazine-typeset">
${html}
    </article>
    <footer class="folio">
      <p class="folio-mark">kumihan</p>
      <p class="folio-label">雑誌組版</p>
    </footer>
  </div>
</body>`
  }

  if (mode === 'feature') {
    return `<body class="feature">
  ${modeSwitcher(mode)}
  <div class="paper feature-sheet">
    <header class="feature-band">
      <p class="feature-kicker">特集</p>
      <p class="feature-issue">kumihan</p>
    </header>
    <article class="typeset feature-typeset">
${html}
    </article>
    <footer class="folio feature-folio">
      <p class="folio-mark">kumihan</p>
      <p class="folio-label">特集</p>
    </footer>
  </div>
</body>`
  }

  return `<body>
  ${modeSwitcher(mode)}
  <div class="paper">
    <article class="typeset">
${html}
    </article>
  </div>
</body>`
}

function modeSwitcher(mode: PreviewMode): string {
  const links = PREVIEW_LINKS.map((item) => {
    const active = item.id === mode
    const current = active ? ' aria-current="page"' : ''
    const activeClass = active ? ' is-active' : ''
    return `    <a class="mode-switch-link${activeClass}" href="${item.href}"${current}>${item.label}</a>`
  }).join('\n')

  return `<nav class="mode-switch" aria-label="表示モード">
${links}
  </nav>`
}

import { escapeHtml } from '../markdown/escape.js'
import { documentSecurityMeta } from '../security/headers.js'
import {
  MAGAZINE_LINES_PER_PAGE,
  MAGAZINE_MEASURE,
  PRINT_LINES_PER_PAGE,
  PRINT_MEASURE,
  paginate,
} from './paginate.js'

export type PreviewMode = 'print' | 'magazine' | 'web'

export interface RenderDocumentOptions {
  title?: string
  language?: string
  mode?: PreviewMode
}

export function renderDocument(html: string, options?: RenderDocumentOptions): string {
  const title = escapeHtml(options?.title ?? 'Typeset Preview')
  const language = escapeHtml(options?.language ?? 'ja')
  const mode: PreviewMode =
    options?.mode === 'web' || options?.mode === 'magazine' ? options.mode : 'print'
  const stylesheet = mode === 'web' ? 'assets/web.css' : 'assets/typeset.css'
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
${renderPapers(paginate(html, MAGAZINE_LINES_PER_PAGE, MAGAZINE_MEASURE), 'typeset cols-2')}
</body>`
  }

  return `<body>
  ${modeSwitcher(mode)}
${renderPapers(paginate(html, PRINT_LINES_PER_PAGE, PRINT_MEASURE), 'typeset')}
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

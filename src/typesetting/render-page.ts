import { escapeHtml } from '../markdown/escape.js'
import { documentSecurityMeta } from '../security/headers.js'
import { MAGAZINE_LINES_PER_PAGE, PRINT_LINES_PER_PAGE, paginate } from './paginate.js'

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

  const head = runningHead(html)

  if (mode === 'magazine') {
    return `<body>
  ${modeSwitcher(mode)}
${renderPapers(paginate(html, MAGAZINE_LINES_PER_PAGE), 'typeset cols-2', head)}
</body>`
  }

  return `<body>
  ${modeSwitcher(mode)}
${renderPapers(paginate(html, PRINT_LINES_PER_PAGE), 'typeset', head)}
</body>`
}

/**
 * 柱に出す文字。原稿の最初の h1 の中身から、インラインのタグだけを外したもの。
 *
 * renderMarkdown は本文も属性値も escapeHtml を通すので、地の文の `>` は実体
 * 参照になっています。つまり `<...>` は本物のタグだけで、そのまま外せます。
 * 外したあとの文字列もエスケープ済みのままなので（`"` は `&quot;`）、
 * data-head の値にそのまま置けます。
 */
function runningHead(html: string): string {
  const inner = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]
  return inner === undefined ? '' : inner.replace(/<[^>]*>/g, '').trim()
}

/**
 * 紙を並べる。下余白のノンブルは data-page、上余白の柱は data-head で渡し、
 * 置き方は CSS の擬似要素に任せます。柱は 1 枚目には出しません。
 */
function renderPapers(pages: string[], articleClass: string, head: string): string {
  const headAttr = head === '' ? '' : ` data-head="${head}"`
  return pages
    .map(
      (page, index) => `  <div class="paper" data-page="${index + 1}"${index === 0 ? '' : headAttr}>
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

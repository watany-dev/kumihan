import { escapeHtml } from '../markdown/escape.js'

export interface RenderDocumentOptions {
  title?: string
  language?: string
}

export function renderDocument(
  html: string,
  options?: RenderDocumentOptions,
): string {
  const title = escapeHtml(options?.title ?? 'Typeset Preview')
  const language = escapeHtml(options?.language ?? 'ja')

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <link rel="stylesheet" href="assets/typeset.css">
</head>
<body>
  <div class="paper">
    <article class="typeset">
${html}
    </article>
  </div>
</body>
</html>
`
}

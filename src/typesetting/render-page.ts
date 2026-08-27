export interface RenderDocumentOptions {
  title?: string
  language?: string
}

export const DEFAULT_TITLE = 'Typeset Preview'
export const DEFAULT_LANGUAGE = 'ja'
export const TYPESET_CSS_HREF = 'assets/typeset.css'

export function renderDocument(
  html: string,
  options?: RenderDocumentOptions,
): string {
  const title = escapeText(options?.title ?? DEFAULT_TITLE)
  const language = escapeText(options?.language ?? DEFAULT_LANGUAGE)

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="${TYPESET_CSS_HREF}">
</head>
<body>
  <div class="paper">
    <article class="typeset">
${indent(html, 6)}
    </article>
  </div>
</body>
</html>
`
}

function indent(html: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return html
    .split('\n')
    .map((line) => (line.length === 0 ? line : pad + line))
    .join('\n')
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

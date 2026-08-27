export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function hasC0Control(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

export function sanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.length === 0 || hasC0Control(trimmed)) {
    return '#'
  }

  const compact = trimmed.replace(/\s+/g, '')
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact)?.[1]?.toLowerCase()
  if (!scheme || scheme === 'https' || scheme === 'http' || scheme === 'mailto') {
    return trimmed
  }

  return '#'
}

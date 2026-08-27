export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function sanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.length === 0 || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    return '#'
  }

  const compact = trimmed.replace(/\s+/g, '')
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact)?.[1]?.toLowerCase()
  if (!scheme || scheme === 'https' || scheme === 'http' || scheme === 'mailto') {
    return trimmed
  }

  return '#'
}

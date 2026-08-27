export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const SAFE_HREF = '#'

export function sanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.length === 0) {
    return SAFE_HREF
  }

  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return SAFE_HREF
  }

  const compact = trimmed.replace(/\s+/g, '')
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact)
  if (!schemeMatch) {
    return trimmed
  }

  const scheme = schemeMatch[1].toLowerCase()
  if (scheme === 'https' || scheme === 'http' || scheme === 'mailto') {
    return trimmed
  }

  return SAFE_HREF
}

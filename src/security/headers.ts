// CSP は 1 つのディレクティブ表から作ります。プレビューは自動リロード用の
// スクリプト 1 本と EventSource を使うので `script-src` / `connect-src` だけ
// `'self'`、export した静的 HTML はスクリプトを含まないので `'none'` のままです。
// インライン・属性のスクリプトはどちらも通しません。
const CSP_DIRECTIVES: ReadonlyArray<readonly [name: string, value: string]> = [
  ['default-src', "'none'"],
  ['base-uri', "'none'"],
  ['form-action', "'none'"],
  ['frame-ancestors', "'none'"],
  ['script-src', "'none'"],
  ['script-src-attr', "'none'"],
  ['style-src', "'self'"],
  ['img-src', "'self' https: http:"],
  ['font-src', "'none'"],
  ['connect-src', "'none'"],
  ['object-src', "'none'"],
  ['media-src', "'none'"],
  ['worker-src', "'none'"],
  ['manifest-src', "'none'"],
]

function contentSecurityPolicy(context: 'export' | 'preview', forMeta: boolean): string {
  const parts: string[] = []
  for (const [name, value] of CSP_DIRECTIVES) {
    // frame-ancestors は <meta> では無視されるので、HTTP ヘッダにだけ残す。
    if (forMeta && name === 'frame-ancestors') continue
    const resolved =
      context === 'preview' && (name === 'script-src' || name === 'connect-src') ? "'self'" : value
    parts.push(`${name} ${resolved}`)
  }
  return parts.join('; ')
}

const PREVIEW_CSP = contentSecurityPolicy('preview', false)
const REFERRER_POLICY = 'no-referrer'

const EXPORT_SECURITY_META = securityMeta(contentSecurityPolicy('export', true))
const PREVIEW_SECURITY_META = securityMeta(contentSecurityPolicy('preview', true))

function securityMeta(policy: string): string {
  return `  <meta http-equiv="Content-Security-Policy" content="${policy}">
  <meta name="referrer" content="${REFERRER_POLICY}">`
}

export function documentSecurityMeta(context: 'export' | 'preview' = 'export'): string {
  return context === 'preview' ? PREVIEW_SECURITY_META : EXPORT_SECURITY_META
}

// 内容は定数なので、リクエストごとに組み立て直さない。以前 hono/secure-headers
// が既定で足していたヘッダも含め、プレビューの応答契約をここに揃える。
const PREVIEW_HEADERS: ReadonlyArray<readonly [name: string, value: string]> = [
  ['Content-Security-Policy', PREVIEW_CSP],
  ['Referrer-Policy', REFERRER_POLICY],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Origin-Agent-Cluster', '?1'],
  ['Strict-Transport-Security', 'max-age=15552000; includeSubDomains'],
  ['X-DNS-Prefetch-Control', 'off'],
  ['X-Download-Options', 'noopen'],
  ['X-Permitted-Cross-Domain-Policies', 'none'],
  ['X-XSS-Protection', '0'],
  [
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), fullscreen=(self)',
  ],
]

export function withPreviewHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of PREVIEW_HEADERS) {
    headers.set(name, value)
  }
  return new Response(response.body, { status: response.status, headers })
}

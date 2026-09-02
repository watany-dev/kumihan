import { secureHeaders } from 'hono/secure-headers'

// CSP は 2 通りあります。プレビューは自動リロード用のスクリプト 1 本と
// EventSource を使うので `script-src 'self'` / `connect-src 'self'`、
// export した静的 HTML はスクリプトを含まないので `'none'` のままです。
// インライン・属性のスクリプトはどちらも通しません。
//
// ディレクティブの表は 1 つ。HTTP ヘッダは hono/secure-headers が受け取る
// 形のまま渡し、`<meta>` 用の文字列もここから組む。片方だけ直して
// ヘッダと meta が食い違う、ということを防ぐためです。
const EXPORT_CSP = {
  defaultSrc: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'none'"],
  frameAncestors: ["'none'"],
  scriptSrc: ["'none'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'https:', 'http:'],
  fontSrc: ["'none'"],
  connectSrc: ["'none'"],
  objectSrc: ["'none'"],
  mediaSrc: ["'none'"],
  workerSrc: ["'none'"],
  manifestSrc: ["'none'"],
}

const PREVIEW_CSP = {
  ...EXPORT_CSP,
  scriptSrc: ["'self'"],
  connectSrc: ["'self'"],
}

const REFERRER_POLICY = 'no-referrer'

// frame-ancestors は <meta> では無視されるので、HTTP ヘッダにだけ残す。
function cspHeader(
  policy: Record<string, readonly string[]>,
  omit: ReadonlySet<string> = new Set(),
): string {
  const parts: string[] = []
  for (const [name, values] of Object.entries(policy)) {
    if (omit.has(name)) continue
    const directive = name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)
    parts.push(`${directive} ${values.join(' ')}`)
  }
  return parts.join('; ')
}

function securityMeta(policy: string): string {
  return `  <meta http-equiv="Content-Security-Policy" content="${policy}">
  <meta name="referrer" content="${REFERRER_POLICY}">`
}

const META_OMIT = new Set(['frameAncestors'])
const EXPORT_SECURITY_META = securityMeta(cspHeader(EXPORT_CSP, META_OMIT))
const PREVIEW_SECURITY_META = securityMeta(cspHeader(PREVIEW_CSP, META_OMIT))

export function documentSecurityMeta(context: 'export' | 'preview' = 'export'): string {
  return context === 'preview' ? PREVIEW_SECURITY_META : EXPORT_SECURITY_META
}

export function previewSecureHeaders() {
  return secureHeaders({
    contentSecurityPolicy: PREVIEW_CSP,
    xFrameOptions: 'DENY',
    referrerPolicy: REFERRER_POLICY,
    permissionsPolicy: {
      accelerometer: false,
      camera: false,
      geolocation: false,
      gyroscope: false,
      magnetometer: false,
      microphone: false,
      payment: false,
      usb: false,
      fullscreen: ['self'],
    },
  })
}

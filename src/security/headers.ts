import { secureHeaders } from 'hono/secure-headers'

// CSP は 2 通りあります。プレビューは自動リロード用のスクリプト 1 本と
// EventSource を使うので `script-src 'self'` / `connect-src 'self'`、
// export した静的 HTML はスクリプトを含まないので `'none'` のままです。
// インライン・属性のスクリプトはどちらも通しません。
const EXPORT_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "script-src 'none'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "img-src 'self' https: http:",
  "font-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
].join('; ')

const PREVIEW_CSP = EXPORT_CSP.replace("script-src 'none'", "script-src 'self'").replace(
  "connect-src 'none'",
  "connect-src 'self'",
)

const REFERRER_POLICY = 'no-referrer'

// frame-ancestors is ignored in <meta>; keep it on the HTTP header only.
function metaCsp(policy: string): string {
  return policy
    .split('; ')
    .filter((directive) => !directive.startsWith('frame-ancestors'))
    .join('; ')
}

// 内容は定数なので、リクエストごとに組み立て直さない。
const EXPORT_SECURITY_META = securityMeta(metaCsp(EXPORT_CSP))
const PREVIEW_SECURITY_META = securityMeta(metaCsp(PREVIEW_CSP))

function securityMeta(policy: string): string {
  return `  <meta http-equiv="Content-Security-Policy" content="${policy}">
  <meta name="referrer" content="${REFERRER_POLICY}">`
}

export function documentSecurityMeta(context: 'export' | 'preview' = 'export'): string {
  return context === 'preview' ? PREVIEW_SECURITY_META : EXPORT_SECURITY_META
}

export function previewSecureHeaders() {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'https:', 'http:'],
      fontSrc: ["'none'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'none'"],
      workerSrc: ["'none'"],
      manifestSrc: ["'none'"],
    },
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

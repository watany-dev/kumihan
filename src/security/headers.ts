import { secureHeaders } from 'hono/secure-headers'

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "script-src 'none'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
].join('; ')

// frame-ancestors is ignored in <meta>; keep it on the HTTP header only.
export const DOCUMENT_CONTENT_SECURITY_POLICY = CONTENT_SECURITY_POLICY.split('; ')
  .filter((directive) => !directive.startsWith('frame-ancestors'))
  .join('; ')

export const REFERRER_POLICY = 'no-referrer'

export function documentSecurityMeta(): string {
  return `  <meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CONTENT_SECURITY_POLICY}">
  <meta name="referrer" content="${REFERRER_POLICY}">`
}

export function previewSecureHeaders() {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
      scriptSrc: ["'none'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'"],
      imgSrc: ["'none'"],
      fontSrc: ["'none'"],
      connectSrc: ["'none'"],
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

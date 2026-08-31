/**
 * 画像ファイルの実寸（CSS ピクセル）を、先頭のバイト列から読み取ります。
 *
 * 頁分けは画像の高さを知らないと当たりません（`paginate.ts`）。原稿の画像は
 * ふつう数枚なので、復号までする必要はなく、寸法を持つ手前の領域だけ読めば
 * 足ります。ここは純粋な関数で、ファイルの読み出しは `measure-images.ts` です。
 *
 * 扱うのは原稿から参照できる形式（`manuscript-path.ts` の一覧）です。読めない
 * 形式や壊れたファイルは null を返し、見積りは従来どおり 1 行に落ちます。
 */
export interface ImageSize {
  /** CSS ピクセル。ブラウザが既定で組む幅。 */
  readonly width: number
  readonly height: number
}

export function imageSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (matches(bytes, 0, PNG_SIGNATURE)) {
    return pngSize(view)
  }
  if (ascii(bytes, 0, 'GIF8')) {
    return gifSize(view)
  }
  if (bytes.length > 1 && view.getUint16(0) === 0xff_d8) {
    return jpegSize(view)
  }
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) {
    return webpSize(bytes, view)
  }
  // ISO BMFF（AVIF / HEIF）。先頭の box は必ず ftyp。
  if (ascii(bytes, 4, 'ftyp')) {
    return isoSize(bytes, view)
  }
  return looksLikeMarkup(bytes) ? svgSize(bytes) : null
}

/**
 * 先頭が `<` で始まる（＝テキストの可能性がある）か。SVG だけが文字列の形式
 * なので、そうでないバイト列を UTF-8 に起こす手間をここで省きます。
 */
function looksLikeMarkup(bytes: Uint8Array): boolean {
  let i = matches(bytes, 0, UTF8_BOM) ? 3 : 0
  while (i < bytes.length) {
    const code = bytes[i] ?? 0
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      i += 1
      continue
    }
    return code === 0x3c
  }
  return false
}

const UTF8_BOM = [0xef, 0xbb, 0xbf]

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function matches(bytes: Uint8Array, start: number, signature: readonly number[]): boolean {
  if (start + signature.length > bytes.length) {
    return false
  }
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[start + i] !== signature[i]) {
      return false
    }
  }
  return true
}

/** bytes の start から text（ASCII）が並んでいるか。 */
function ascii(bytes: Uint8Array, start: number, text: string): boolean {
  if (start + text.length > bytes.length) {
    return false
  }
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[start + i] !== text.charCodeAt(i)) {
      return false
    }
  }
  return true
}

function sized(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null
}

/** PNG は署名の直後が IHDR で、幅と高さがその先頭にある。 */
function pngSize(view: DataView): ImageSize | null {
  if (view.byteLength < 24) {
    return null
  }
  return sized(view.getUint32(16), view.getUint32(20))
}

/** GIF は論理画面記述子の幅・高さ（リトルエンディアン）。 */
function gifSize(view: DataView): ImageSize | null {
  if (view.byteLength < 10) {
    return null
  }
  return sized(view.getUint16(6, true), view.getUint16(8, true))
}

/** 寸法を持つ JPEG のフレーム開始マーカーか。DHT・JPG・DAC は別物。 */
function isFrameStart(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/**
 * JPEG はセグメントの列。長さを頼りに読み飛ばし、フレーム開始まで進みます。
 * 走査の開始（SOS）まで来たら、そこから先は圧縮された画素なので諦めます。
 */
function jpegSize(view: DataView): ImageSize | null {
  let i = 2
  while (i + 9 < view.byteLength) {
    if (view.getUint8(i) !== 0xff) {
      return null
    }
    const marker = view.getUint8(i + 1)
    // 0xff の詰め物と、長さを持たないマーカー。
    if (marker === 0xff) {
      i += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2
      continue
    }
    if (isFrameStart(marker)) {
      return sized(view.getUint16(i + 7), view.getUint16(i + 5))
    }
    if (marker === 0xda) {
      return null
    }
    const length = view.getUint16(i + 2)
    if (length < 2) {
      return null
    }
    i += 2 + length
  }
  return null
}

/**
 * WebP は RIFF の最初のチャンクが寸法を持ちます。非可逆（VP8）はキーフレーム
 * 見出し、可逆（VP8L）は詰めたビット列、拡張（VP8X）はキャンバスの寸法です。
 */
function webpSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  if (ascii(bytes, 12, 'VP8 ') && view.byteLength >= 30) {
    // キーフレームの同期コード。動画の途中フレームには寸法が無い。
    if (!matches(bytes, 23, [0x9d, 0x01, 0x2a])) {
      return null
    }
    return sized(view.getUint16(26, true) & 0x3f_ff, view.getUint16(28, true) & 0x3f_ff)
  }
  if (ascii(bytes, 12, 'VP8L') && view.byteLength >= 25) {
    if (view.getUint8(20) !== 0x2f) {
      return null
    }
    const bits = view.getUint32(21, true)
    return sized((bits & 0x3f_ff) + 1, ((bits >>> 14) & 0x3f_ff) + 1)
  }
  if (ascii(bytes, 12, 'VP8X') && view.byteLength >= 30) {
    return sized(uint24(view, 24) + 1, uint24(view, 27) + 1)
  }
  return null
}

function uint24(view: DataView, start: number): number {
  return view.getUint8(start) | (view.getUint8(start + 1) << 8) | (view.getUint8(start + 2) << 16)
}

/**
 * AVIF / HEIF の寸法は ispe プロパティにあります。box の木を降りずに ispe を
 * 拾い、いちばん大きいものを採ります（縮小版が別の ispe で入っているため）。
 */
function isoSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  let best: ImageSize | null = null
  for (let i = 8; i + 16 <= view.byteLength; i += 1) {
    if (!ascii(bytes, i, 'ispe')) {
      continue
    }
    // size(4) type(4) version+flags(4) width(4) height(4)
    const found = sized(view.getUint32(i + 8), view.getUint32(i + 12))
    if (
      found !== null &&
      (best === null || found.width * found.height > best.width * best.height)
    ) {
      best = found
    }
  }
  return best
}

// ===== SVG =====

const SVG_UNITS = new Map<string, number>([
  ['', 1],
  ['px', 1],
  ['pt', 96 / 72],
  ['pc', 16],
  ['in', 96],
  ['mm', 96 / 25.4],
  ['cm', 96 / 2.54],
  ['q', 96 / 101.6],
])

/**
 * SVG は文字列です。`<svg>` の width / height を読み、無ければ viewBox の
 * 大きさで代えます（片方だけあるときは viewBox の縦横比で補います）。
 * 相対長（`%` や `em`）は組む先で決まるので、寸法としては読めません。
 */
function svgSize(bytes: Uint8Array): ImageSize | null {
  const text = new TextDecoder('utf-8').decode(bytes)
  const start = text.indexOf('<svg')
  if (start === -1) {
    return null
  }
  const end = text.indexOf('>', start)
  const tag = text.slice(start, end === -1 ? text.length : end)

  const width = svgLength(attribute(tag, 'width'))
  const height = svgLength(attribute(tag, 'height'))
  if (width !== null && height !== null) {
    return sized(width, height)
  }

  const box = viewBox(attribute(tag, 'viewBox'))
  if (box === null) {
    return null
  }
  if (width !== null) {
    return sized(width, (width * box.height) / box.width)
  }
  if (height !== null) {
    return sized((height * box.width) / box.height, height)
  }
  return sized(box.width, box.height)
}

function attribute(tag: string, name: string): string | null {
  const found = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*')`).exec(tag)
  return found === null ? null : (found[1] ?? '').slice(1, -1).trim()
}

function svgLength(value: string | null): number | null {
  if (value === null) {
    return null
  }
  const found = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*([a-z]*)$/i.exec(value)
  if (found === null) {
    return null
  }
  const scale = SVG_UNITS.get((found[2] ?? '').toLowerCase())
  if (scale === undefined) {
    return null
  }
  const length = Number(found[1]) * scale
  return Number.isFinite(length) && length > 0 ? length : null
}

function viewBox(value: string | null): { width: number; height: number } | null {
  if (value === null) {
    return null
  }
  const numbers = value
    .split(/[\s,]+/)
    .filter((part) => part.length > 0)
    .map(Number)
  if (numbers.length !== 4) {
    return null
  }
  const width = numbers[2] ?? 0
  const height = numbers[3] ?? 0
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
}

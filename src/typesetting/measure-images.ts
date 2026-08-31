import { open } from 'node:fs/promises'

import { resolveManuscriptFile } from '../manuscript-path.js'
import { unescapeHtml } from '../markdown/escape.js'
import { imageSize, type ImageSize } from './image-size.js'

/**
 * 断片の `<img>` に、画像ファイルの実寸を width / height として書き入れます。
 *
 * 頁分け（`paginate.ts`）は、これが入っていれば画像の組み上がりの高さを
 * 見積もれます。ブラウザにとっても、読み込む前に場所を空けられるので、
 * 画像が入った瞬間に行がずれることがなくなります。
 *
 * 寸法は原稿からの相対パスで見つかったファイルだけから読みます。外部の URL や
 * 原稿の外を指す参照は、プレビューが配らないものなので触れません。読めない
 * 画像は属性を足さず、見積りは従来どおり 1 行に落ちます。
 */
export async function withImageSizes(fragment: string, root: string): Promise<string> {
  if (!fragment.includes('<img')) {
    return fragment
  }

  // 同じ画像が何度も出てくる原稿でも、ファイルを読むのは 1 回だけにします。
  const sources = new Set<string>()
  for (const tag of fragment.matchAll(IMAGE_TAG)) {
    const src = measurableSource(tag[0])
    if (src !== null) {
      sources.add(src)
    }
  }
  if (sources.size === 0) {
    return fragment
  }

  const sizes = new Map<string, ImageSize>()
  await Promise.all(
    [...sources].map(async (src) => {
      const size = await sizeOf(root, src)
      if (size !== null) {
        sizes.set(src, size)
      }
    }),
  )

  return fragment.replace(IMAGE_TAG, (tag) => {
    const src = measurableSource(tag)
    const size = src === null ? undefined : sizes.get(src)
    if (size === undefined) {
      return tag
    }
    const width = Math.max(1, Math.round(size.width))
    const height = Math.max(1, Math.round(size.height))
    return `${tag.slice(0, -1)} width="${width}" height="${height}">`
  })
}

const IMAGE_TAG = /<img\b[^>]*>/g
const SOURCE = /\ssrc="([^"]*)"/
const SIZED = /\s(?:width|height)\s*=/

/** 実寸を読みにいく相対パス。読む相手が無いタグは null。 */
function measurableSource(tag: string): string | null {
  // すでに寸法を持つタグ（原稿が書いたもの）はそのまま尊重します。
  if (SIZED.test(tag)) {
    return null
  }
  const found = SOURCE.exec(tag)
  if (found === null) {
    return null
  }
  // src は HTML として書いたあとの文字列なので、ファイルを探す前に戻します
  // （`a&amp;b.png`）。write-files.ts の画像複製と同じ扱いです。
  const src = unescapeHtml(found[1] ?? '')
  if (src.length === 0 || src.startsWith('#') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) {
    return null
  }
  return src
}

// 寸法は先頭にあります。JPEG は Exif や ICC プロファイルが前に挟まるので、
// その並びを越えられるだけ読みます（これで足りない画像は諦めます）。
const HEADER_BYTES = 64 * 1024

async function sizeOf(root: string, src: string): Promise<ImageSize | null> {
  const file = await resolveManuscriptFile(root, src)
  if (file === null) {
    return null
  }
  try {
    const handle = await open(file)
    try {
      const buffer = new Uint8Array(HEADER_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0)
      return imageSize(buffer.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  } catch {
    // 読めない画像（権限、途中で消えた、ディレクトリ）は寸法なしにします。
    // プレビューも書き出しも、画像 1 つで止めるほどのことではありません。
    return null
  }
}

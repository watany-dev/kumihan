import { realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

const IMAGE_TYPE = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.avif', 'image/avif'],
])

export function imageContentType(filePath: string): string | undefined {
  return IMAGE_TYPE.get(extname(filePath).toLowerCase())
}

/**
 * 原稿ディレクトリ基準の相対パスを、読める画像ファイルへ解決します。
 * 空・NUL・バックスラッシュ・スキーム・絶対パス・allowlist 外・root 外
 * （`../` と symlink）は null。
 */
export async function resolveManuscriptFile(root: string, rel: string): Promise<string | null> {
  let decoded: string
  try {
    decoded = decodeURIComponent(rel)
  } catch {
    return null
  }
  if (
    decoded.length === 0 ||
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    isAbsolute(decoded) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded) ||
    imageContentType(decoded) === undefined
  ) {
    return null
  }

  const rootResolved = resolve(root)
  const candidate = resolve(rootResolved, decoded)
  if (!contained(rootResolved, candidate)) {
    return null
  }

  try {
    const real = await realpath(candidate)
    const realRoot = await realpath(rootResolved)
    if (!contained(realRoot, real)) {
      return null
    }
    return real
  } catch {
    return null
  }
}

function contained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

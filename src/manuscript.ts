import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/**
 * 原稿の取り出し方をまとめたもの。ファイルから読むときと、パイプで
 * 受け取った本文をそのまま使うときの違いを、ここ 1 か所に閉じ込めます。
 */
export interface Manuscript {
  /** 画像の相対パスを解決する基準ディレクトリ（絶対パス）。 */
  root: string
  /** 原稿本文。ファイルの場合は呼ぶたび読み直します（プレビューの更新のため）。 */
  read(): Promise<string>
}

export function fileManuscript(path: string): Manuscript {
  return {
    root: dirname(resolve(path)),
    read: () => readFile(path, 'utf8'),
  }
}

/**
 * すでに手元にある本文を原稿として扱います。標準入力には元ファイルの場所が
 * 無いので、画像の相対パスはカレントディレクトリから探します。
 */
export function memoryManuscript(markdown: string, root: string = process.cwd()): Manuscript {
  const resolved = resolve(root)
  return {
    root: resolved,
    read: () => Promise.resolve(markdown),
  }
}

export function toManuscript(source: string | Manuscript): Manuscript {
  return typeof source === 'string' ? fileManuscript(source) : source
}

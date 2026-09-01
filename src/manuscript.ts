import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

/**
 * 原稿の取り出し方をまとめたもの。ファイルから読むときと、パイプで
 * 受け取った本文をそのまま使うときの違いを、ここ 1 か所に閉じ込めます。
 */
export interface Manuscript {
  /** 画像の相対パスを解決する基準ディレクトリ（絶対パス）。 */
  root: string
  /**
   * 原稿ファイルの絶対パス。ファイルから読むときだけ入ります。
   * 標準入力には元ファイルが無いので持ちません。
   */
  file?: string
  /** 原稿本文。ファイルの場合は呼ぶたび読み直します（プレビューの更新のため）。 */
  read(): Promise<string>
  /**
   * 原稿が変わったかもしれないときに onChange を呼びます。戻り値で監視を
   * やめます。呼ばれた側が read() し直して、本当に変わったかを確かめる
   * 約束です（保存の途中や、触っただけの保存でも呼ばれてよい）。
   * 変わりようのない原稿（標準入力）は undefined です。
   */
  watch?(onChange: () => void): () => void
}

/**
 * すでに手元にある本文を原稿として扱います。標準入力には元ファイルの場所が
 * 無いので、画像の相対パスはカレントディレクトリから探します。
 */
export function memoryManuscript(markdown: string, root: string = process.cwd()): Manuscript {
  return {
    root: resolve(root),
    read: () => Promise.resolve(markdown),
  }
}

/** 原稿ファイルのパス、または取り出し方を差し替えた原稿（標準入力など）。 */
export type ManuscriptSource = string | Manuscript

export function toManuscript(source: ManuscriptSource): Manuscript {
  if (typeof source !== 'string') return source
  const file = resolve(source)
  return {
    root: dirname(file),
    file,
    read: () => readFile(file, 'utf8'),
    watch: (onChange) => watchManuscriptFile(file, onChange),
  }
}

/**
 * エディタの保存は「書き換え」とは限りません。多くは一時ファイルに書いて
 * から rename で置き換えるので、ファイルそのものを見ていると保存のたびに
 * 監視が外れます。親ディレクトリを見て、原稿の名前のイベントだけ拾います。
 */
function watchManuscriptFile(file: string, onChange: () => void): () => void {
  const name = basename(file)
  try {
    // node:fs は読み込むだけで起動が 10ms ほど延びます（実測）。監視が要るのは
    // プレビューの /events に購読者がいるあいだだけなので、モジュールの import
    // ではなくここで取り出します。同期に取れるので、下の catch（fs.watch が
    // 使えないファイルシステム）も戻り値の同期契約もそのままです。
    const { watch } = process.getBuiltinModule('node:fs')
    const watcher = watch(dirname(file), (_event, filename) => {
      // filename が取れない環境もあるので、そのときは読み直しに倒します。
      if (filename === null || filename === name) onChange()
    })
    // ディレクトリごと消されるなど、監視が続けられなくなったら黙って止めます。
    // 放っておくと 'error' が未処理例外になり、プレビューごと落ちます。
    watcher.on('error', () => watcher.close())
    return () => watcher.close()
  } catch {
    // fs.watch が使えないファイルシステムでは、1 秒ごとの読み直しに落とします。
    const timer = setInterval(onChange, 1000)
    return () => clearInterval(timer)
  }
}

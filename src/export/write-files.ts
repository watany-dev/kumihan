import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { contained, resolveManuscriptFile } from '../manuscript-path.js'
import { toManuscript, type ManuscriptSource } from '../manuscript.js'
import { unescapeHtml } from '../markdown/escape.js'
import { renderMarkdown } from '../markdown/render.js'
import { exportSite } from './export-site.js'

export async function writeExport(source: ManuscriptSource, outDir: string): Promise<string[]> {
  const manuscript = toManuscript(source)
  const markdown = await manuscript.read()

  // 書き出しは互いに独立しているので、直列に待たずまとめて実行する。
  const written = await Promise.all(
    exportSite(markdown).map(async (asset) => {
      const dest = join(outDir, asset.pathname.replace(/^\//, ''))
      await mkdir(dirname(dest), { recursive: true })
      // 本文は元から文字列なので、arrayBuffer() で UTF-8 へ起こし直さず
      // そのまま渡します（writeFile の既定が UTF-8 なのでバイト列は同じ）。
      await writeFile(dest, await asset.response.text())
      return dest
    }),
  )
  const destRoot = resolve(outDir)
  const copied: string[] = []
  for (const match of renderMarkdown(markdown).matchAll(/<img src="([^"]*)"/g)) {
    // src は HTML として書き出した後の文字列です。名前に `&` や `'` を含む
    // 画像は `a&amp;b.png` のようになっているので、ファイルを探す前に戻します。
    // ブラウザは実体参照を戻してから要求するので、戻さないとプレビューには
    // 出るのに書き出しにだけ画像が無い、という食い違いになります。
    const src = unescapeHtml(match[1] ?? '')
    if (src.length === 0 || src.startsWith('#') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) continue
    const from = await resolveManuscriptFile(manuscript.root, src)
    if (from === null) {
      console.error(`[kumihan] 画像が見つかりません: ${src}`)
      continue
    }
    let destRel = src
    try {
      destRel = decodeURIComponent(src)
    } catch {
      console.error(`[kumihan] 画像の出力先が不正です: ${src}`)
      continue
    }
    const dest = resolve(destRoot, destRel)
    if (!contained(destRoot, dest)) {
      console.error(`[kumihan] 画像の出力先が不正です: ${src}`)
      continue
    }
    // 画像として通った参照でも、複製そのものは失敗しえます（`figures.png` と
    // いう名前のディレクトリ、読めない権限、途中で消えたファイル）。ここで
    // 投げると HTML まで含めて書き出し全体が止まるので、その画像だけ諦めます。
    try {
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(from, dest)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error(`[kumihan] 画像を書き出せません: ${src} (${detail})`)
      continue
    }
    copied.push(dest)
  }
  return [...written, ...copied]
}

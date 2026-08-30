import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { contained, resolveManuscriptFile } from '../manuscript-path.js'
import { renderMarkdown } from '../markdown/render.js'
import { exportSite } from './export-site.js'

export async function writeExport(source: string, outDir: string): Promise<string[]> {
  const markdown = await readFile(source, 'utf8')

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
  const root = dirname(resolve(source))
  const destRoot = resolve(outDir)
  const copied: string[] = []
  for (const match of renderMarkdown(markdown).matchAll(/<img src="([^"]*)"/g)) {
    const src = match[1] ?? ''
    if (src.length === 0 || src.startsWith('#') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) continue
    const from = await resolveManuscriptFile(root, src)
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
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(from, dest)
    copied.push(dest)
  }
  return [...written, ...copied]
}

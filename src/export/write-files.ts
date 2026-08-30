import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { resolveManuscriptFile } from '../manuscript-path.js'
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
  const copied = await copyLocalImages(markdown, dirname(resolve(source)), outDir)
  return [...written, ...copied]
}

async function copyLocalImages(markdown: string, root: string, outDir: string): Promise<string[]> {
  const copied: string[] = []
  const seen = new Set<string>()
  for (const src of localImageSrcs(renderMarkdown(markdown))) {
    if (seen.has(src)) continue
    seen.add(src)
    const from = await resolveManuscriptFile(root, src)
    if (from === null) {
      console.error(`[kumihan] 画像が見つかりません: ${src}`)
      continue
    }
    const dest = join(outDir, src)
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(from, dest)
    copied.push(dest)
  }
  return copied
}

function localImageSrcs(html: string): string[] {
  const srcs: string[] = []
  for (const match of html.matchAll(/<img src="([^"]*)"/g)) {
    const src = unescapeAttr(match[1] ?? '')
    if (src.length === 0 || src.startsWith('#') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) {
      continue
    }
    srcs.push(src)
  }
  return srcs
}

function unescapeAttr(value: string): string {
  if (!value.includes('&')) return value
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

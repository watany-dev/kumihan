import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { exportSite } from './export-site.js'

export async function writeExport(source: string, outDir: string): Promise<string[]> {
  const markdown = await readFile(source, 'utf8')

  // 書き出しは互いに独立しているので、直列に待たずまとめて実行する。
  return Promise.all(
    exportSite(markdown).map(async (asset) => {
      const dest = join(outDir, asset.pathname.replace(/^\//, ''))
      await mkdir(dirname(dest), { recursive: true })
      // 本文は元から文字列なので、arrayBuffer() で UTF-8 へ起こし直さず
      // そのまま渡します（writeFile の既定が UTF-8 なのでバイト列は同じ）。
      await writeFile(dest, await asset.response.text())
      return dest
    }),
  )
}

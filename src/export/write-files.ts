import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { exportSite } from './export-site.js'

export async function writeExport(source: string, outDir: string): Promise<string[]> {
  const markdown = await readFile(source, 'utf8')
  const written: string[] = []

  for (const asset of exportSite(markdown)) {
    const dest = join(outDir, asset.pathname.replace(/^\//, ''))
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, Buffer.from(await asset.response.arrayBuffer()))
    written.push(dest)
  }

  return written
}

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { exportSite } from '../src/export/export-site.js'

const source = process.argv[2] ?? './content/index.md'
const outDir = process.argv[3] ?? './dist'

try {
  const markdown = await readFile(source, 'utf8')
  const assets = exportSite(markdown)

  for (const asset of assets) {
    const dest = join(outDir, asset.pathname.replace(/^\//, ''))
    await mkdir(dirname(dest), { recursive: true })
    const bytes = Buffer.from(await asset.response.arrayBuffer())
    await writeFile(dest, bytes)
    console.log(`wrote ${dest}`)
  }
} catch (error) {
  console.error('[kumihan] Static export failed:', error)
  process.exitCode = 1
}

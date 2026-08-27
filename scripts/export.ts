import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { exportSite } from '../src/export/export-site.js'

const markdown = await readFile('./content/index.md', 'utf8')

for (const asset of exportSite(markdown)) {
  const dest = join('dist', asset.pathname.replace(/^\//, ''))
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.from(await asset.response.arrayBuffer()))
  console.log(`wrote ${dest}`)
}

import { writeExport } from '../src/export/write-files.js'

const written = await writeExport({
  source: './content/index.md',
  outDir: 'dist',
})

for (const dest of written) {
  console.log(`wrote ${dest}`)
}

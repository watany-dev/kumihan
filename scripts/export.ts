import { writeExport } from '../src/export/write-files.js'

for (const dest of await writeExport('./content/index.md', 'dist')) {
  console.log(`wrote ${dest}`)
}

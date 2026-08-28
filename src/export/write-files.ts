import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { RenderDocumentOptions } from '../typesetting/render-page.js'
import { exportSite } from './export-site.js'

export interface WriteExportOptions {
  source: string
  outDir: string
  title?: string
  language?: string
}

export async function writeExport(options: WriteExportOptions): Promise<string[]> {
  const markdown = await readFile(options.source, 'utf8')
  const written: string[] = []

  for (const asset of exportSite(markdown, documentOptions(options))) {
    const dest = join(options.outDir, asset.pathname.replace(/^\//, ''))
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, Buffer.from(await asset.response.arrayBuffer()))
    written.push(dest)
  }

  return written
}

function documentOptions(options: WriteExportOptions): RenderDocumentOptions | undefined {
  const renderOptions: RenderDocumentOptions = {}
  if (options.title !== undefined) {
    renderOptions.title = options.title
  }
  if (options.language !== undefined) {
    renderOptions.language = options.language
  }
  if (renderOptions.title === undefined && renderOptions.language === undefined) {
    return undefined
  }
  return renderOptions
}

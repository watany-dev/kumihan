import { parseArgs } from 'node:util'

import { createPreviewApp } from './app.js'
import { writeExport } from './export/write-files.js'
import { createNodeServer } from './node-server.js'

const VERSION = '0.1.0'
const USAGE = `kumihan ${VERSION}
  kumihan serve [file]    # content/index.md, 127.0.0.1:3000
  kumihan export [file]   # --out dist`

let values: {
  help: boolean
  version: boolean
  port: string
  host: string
  out: string
}
let positionals: string[]
try {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      port: { type: 'string', short: 'p', default: '3000' },
      host: { type: 'string', short: 'H', default: '127.0.0.1' },
      out: { type: 'string', short: 'o', default: 'dist' },
    },
  })
  values = parsed.values
  positionals = parsed.positionals
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}
if (values.version) {
  console.log(VERSION)
  process.exit(0)
}

const command = positionals[0]
const source = positionals[1] ?? 'content/index.md'

if (command === 'export') {
  for (const dest of await writeExport(source, values.out)) {
    console.log(`wrote ${dest}`)
  }
} else if (command === 'serve') {
  const { host, port: portValue } = values
  // 数値でない --port は listen に NaN を渡し、Node が任意の空きポートを
  // 選んでしまいます。意図しないポートで公開しないよう、先に弾きます。
  const port = Number(portValue)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`invalid --port: ${portValue}`)
    process.exit(1)
  }
  createNodeServer(createPreviewApp({ source })).listen(port, host, () => {
    const shown = host === '0.0.0.0' ? '127.0.0.1' : host
    console.log(`Typeset preview: http://${shown}:${port}`)
    console.log(`Two-column preview: http://${shown}:${port}/magazine.html`)
    console.log(`Web article preview: http://${shown}:${port}/web.html`)
  })
} else {
  console.error(USAGE)
  process.exit(1)
}

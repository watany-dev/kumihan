import { Buffer } from 'node:buffer'
import { parseArgs } from 'node:util'

import { createPreviewApp } from './app.js'
import { writeExport } from './export/write-files.js'
import { memoryManuscript, type ManuscriptSource } from './manuscript.js'
import { createNodeServer, describeListenError } from './node-server.js'
import { createHostPolicy } from './security/host.js'

const VERSION = '0.1.0'
const USAGE = `kumihan ${VERSION}
  kumihan serve [file|-]    # content/index.md, 127.0.0.1:3000
  kumihan export [file|-]   # --out dist
  \`-\` か端末以外の標準入力から読むときは、画像はカレントディレクトリから探します`

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
      host: { type: 'string', short: 'H', default: process.env['KUMIHAN_HOST'] ?? '127.0.0.1' },
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
const arg = positionals[1]
const source = arg ?? 'content/index.md'

// `-` なら必ず標準入力。export は引数省略時も、端末以外（パイプや
// リダイレクト）がつながっていれば読みます。serve は `-` を明示した
// ときだけ読む。そうしないと `bun run dev` を端末以外から起動したとき、
// 閉じない標準入力で待ち受けまで届かない。
let manuscript: ManuscriptSource = source
const takeStdin = arg === '-' || (command === 'export' && arg === undefined && !process.stdin.isTTY)
if ((command === 'export' || command === 'serve') && takeStdin) {
  const piped = Buffer.concat(await process.stdin.toArray()).toString('utf8')
  if (piped.trim().length > 0) {
    manuscript = memoryManuscript(piped)
  } else if (arg === '-') {
    console.error('標準入力が空です')
    process.exit(1)
  }
  // export の省略時に何も流れてこなかった場合は、端末以外につながっている
  // だけの起動（CI）とみなして既定の原稿に戻します。
}

if (command === 'export') {
  // 原稿が無いときに素の例外を出すと、内部のスタックや errno がそのまま
  // 出てしまいます。打ち間違いは普通に起きるので、短く伝えて終わります。
  try {
    for (const dest of await writeExport(manuscript, values.out)) {
      console.log(`wrote ${dest}`)
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.error(`原稿が見つかりません: ${source}`)
    } else {
      const detail = error instanceof Error ? error.message : String(error)
      console.error(`書き出しに失敗しました: ${detail}`)
    }
    process.exit(1)
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
  // Host が自分の名前のときだけ原稿を返します（DNS リバインディング対策）。
  // 詳しくは src/security/host.ts を参照。
  const hostPolicy = createHostPolicy({
    host,
    allowed: process.env['KUMIHAN_ALLOWED_HOSTS'],
    portForwardingDomain: process.env['GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN'],
  })
  const server = createNodeServer(createPreviewApp({ source: manuscript }), hostPolicy)
  // listen の失敗は例外ではなくイベントで届きます。受け取らないと、使えない
  // ホスト名や埋まっているポートを指定しただけで内部のスタックが出ます。
  server.on('error', (error) => {
    console.error(describeListenError(error, host, port))
    process.exit(1)
  })
  server.listen(port, host, () => {
    const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
    console.log(`Typeset preview: http://${shown}:${port}`)
    console.log(`Two-column preview: http://${shown}:${port}/magazine.html`)
    console.log(`Web article preview: http://${shown}:${port}/web.html`)
  })
} else {
  console.error(USAGE)
  process.exit(1)
}

import { VERSION } from '../version.js'

export { VERSION }

export const DEFAULT_SOURCE = 'content/index.md'
export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 3000
export const DEFAULT_OUT_DIR = 'dist'

export const USAGE = `kumihan — Markdown を組版 HTML にするツール

使い方:
  kumihan serve [file] [options]
  kumihan export [file] [options]
  kumihan --help
  kumihan --version

コマンド:
  serve     プレビューサーバを起動する（既定の file は content/index.md）
  export    静的 HTML と CSS を書き出す

オプション:
  -p, --port <port>     serve の待ち受けポート（既定: 3000）
  -H, --host <host>     serve の待ち受けアドレス（既定: 127.0.0.1）
  -o, --out <dir>       export の出力先（既定: dist）
      --title <title>   HTML の title
      --lang <lang>     HTML の lang（既定: ja）
  -h, --help            このヘルプ
  -v, --version         バージョンを表示する`

export type ServeCommand = {
  type: 'serve'
  source: string
  host: string
  port: number
  title?: string
  language?: string
}

export type ExportCommand = {
  type: 'export'
  source: string
  outDir: string
  title?: string
  language?: string
}

export type ParsedArgs =
  | { ok: true; command: { type: 'help' } }
  | { ok: true; command: { type: 'version' } }
  | { ok: true; command: ServeCommand }
  | { ok: true; command: ExportCommand }
  | { ok: false; message: string }

type OptionName = 'port' | 'host' | 'out' | 'title' | 'lang'

const OPTIONS = new Map<string, OptionName>([
  ['-p', 'port'],
  ['--port', 'port'],
  ['-H', 'host'],
  ['--host', 'host'],
  ['-o', 'out'],
  ['--out', 'out'],
  ['--title', 'title'],
  ['--lang', 'lang'],
  ['--language', 'lang'],
])

export function parseArgs(argv: string[]): ParsedArgs {
  let commandName: 'serve' | 'export' | undefined
  let source: string | undefined
  let host: string | undefined
  let port: number | undefined
  let outDir: string | undefined
  let title: string | undefined
  let language: string | undefined
  let help = false
  let version = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === undefined) {
      continue
    }

    if (arg === '--') {
      const rest = argv.slice(i + 1)
      for (const positional of rest) {
        const consumed = consumePositional(positional, commandName, source)
        if (!consumed.ok) {
          return consumed
        }
        commandName = consumed.commandName
        source = consumed.source
      }
      break
    }

    if (arg === '-h' || arg === '--help') {
      help = true
      continue
    }

    if (arg === '-v' || arg === '--version') {
      version = true
      continue
    }

    const option = readOption(arg)
    if (option !== undefined) {
      let value = option.inline
      if (value === undefined) {
        const next = argv[i + 1]
        if (next === undefined || next.startsWith('-')) {
          return { ok: false, message: `${option.flag} の値が必要です。` }
        }
        value = next
        i += 1
      }
      if (value === '') {
        return { ok: false, message: `${option.flag} の値が必要です。` }
      }

      const assigned = assignOption(option.name, option.flag, value, {
        host,
        port,
        outDir,
        title,
        language,
      })
      if (!assigned.ok) {
        return assigned
      }
      host = assigned.host
      port = assigned.port
      outDir = assigned.outDir
      title = assigned.title
      language = assigned.language
      continue
    }

    if (arg.startsWith('-')) {
      return { ok: false, message: `不明なオプションです: ${arg}` }
    }

    const consumed = consumePositional(arg, commandName, source)
    if (!consumed.ok) {
      return consumed
    }
    commandName = consumed.commandName
    source = consumed.source
  }

  if (help) {
    return { ok: true, command: { type: 'help' } }
  }
  if (version) {
    return { ok: true, command: { type: 'version' } }
  }
  if (commandName === undefined) {
    return { ok: false, message: 'serve または export を指定してください。' }
  }

  if (commandName === 'serve') {
    if (outDir !== undefined) {
      return { ok: false, message: '--out は export 専用です。' }
    }
    const command: ServeCommand = {
      type: 'serve',
      source: source ?? DEFAULT_SOURCE,
      host: host ?? DEFAULT_HOST,
      port: port ?? DEFAULT_PORT,
    }
    assignDocumentOptions(command, title, language)
    return { ok: true, command }
  }

  if (host !== undefined || port !== undefined) {
    return { ok: false, message: '--host / --port は serve 専用です。' }
  }

  const command: ExportCommand = {
    type: 'export',
    source: source ?? DEFAULT_SOURCE,
    outDir: outDir ?? DEFAULT_OUT_DIR,
  }
  assignDocumentOptions(command, title, language)
  return { ok: true, command }
}

function readOption(arg: string): { name: OptionName; flag: string; inline?: string } | undefined {
  const eq = arg.indexOf('=')
  if (eq === -1) {
    const name = OPTIONS.get(arg)
    if (name === undefined) {
      return undefined
    }
    return { name, flag: arg }
  }

  const flag = arg.slice(0, eq)
  const name = OPTIONS.get(flag)
  if (name === undefined) {
    return undefined
  }
  return { name, flag, inline: arg.slice(eq + 1) }
}

function consumePositional(
  value: string,
  commandName: 'serve' | 'export' | undefined,
  source: string | undefined,
):
  | { ok: true; commandName: 'serve' | 'export'; source: string | undefined }
  | { ok: false; message: string } {
  if (commandName === undefined) {
    if (value === 'serve' || value === 'export') {
      return { ok: true, commandName: value, source }
    }
    return { ok: false, message: `不明なコマンドです: ${value}` }
  }
  if (source === undefined) {
    return { ok: true, commandName, source: value }
  }
  return { ok: false, message: `予期しない引数です: ${value}` }
}

function assignOption(
  name: OptionName,
  flag: string,
  value: string,
  current: {
    host: string | undefined
    port: number | undefined
    outDir: string | undefined
    title: string | undefined
    language: string | undefined
  },
):
  | {
      ok: true
      host: string | undefined
      port: number | undefined
      outDir: string | undefined
      title: string | undefined
      language: string | undefined
    }
  | { ok: false; message: string } {
  if (name === 'port') {
    if (current.port !== undefined) {
      return { ok: false, message: `${flag} は複数回指定できません。` }
    }
    const port = parsePort(value)
    if (port === undefined) {
      return { ok: false, message: `ポートは 0 から 65535 の整数です: ${value}` }
    }
    return { ok: true, ...current, port }
  }

  if (name === 'host') {
    if (current.host !== undefined) {
      return { ok: false, message: `${flag} は複数回指定できません。` }
    }
    return { ok: true, ...current, host: value }
  }

  if (name === 'out') {
    if (current.outDir !== undefined) {
      return { ok: false, message: `${flag} は複数回指定できません。` }
    }
    return { ok: true, ...current, outDir: value }
  }

  if (name === 'title') {
    if (current.title !== undefined) {
      return { ok: false, message: `${flag} は複数回指定できません。` }
    }
    return { ok: true, ...current, title: value }
  }

  if (current.language !== undefined) {
    return { ok: false, message: `${flag} は複数回指定できません。` }
  }
  return { ok: true, ...current, language: value }
}

function parsePort(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined
  }
  const port = Number.parseInt(value, 10)
  if (port > 65535) {
    return undefined
  }
  return port
}

function assignDocumentOptions(
  command: { title?: string; language?: string },
  title: string | undefined,
  language: string | undefined,
): void {
  if (title !== undefined) {
    command.title = title
  }
  if (language !== undefined) {
    command.language = language
  }
}

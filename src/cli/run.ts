import { writeExport } from '../export/write-files.js'
import { parseArgs, USAGE, VERSION, type ParsedArgs } from './args.js'
import { startPreviewServer } from './serve.js'

export interface CliIo {
  log: (message: string) => void
  error: (message: string) => void
}

export interface RunResult {
  code: number
  close?: () => Promise<void>
}

export async function runCommand(argv: string[], io: CliIo): Promise<RunResult> {
  return dispatch(parseArgs(argv), io)
}

export async function dispatch(parsed: ParsedArgs, io: CliIo): Promise<RunResult> {
  if (!parsed.ok) {
    io.error(parsed.message)
    io.error('')
    io.error(USAGE)
    return { code: 1 }
  }

  const { command } = parsed
  if (command.type === 'help') {
    io.log(USAGE)
    return { code: 0 }
  }
  if (command.type === 'version') {
    io.log(VERSION)
    return { code: 0 }
  }
  if (command.type === 'export') {
    return runExport(command, io)
  }
  return runServe(command, io)
}

async function runExport(
  command: { source: string; outDir: string; title?: string; language?: string },
  io: CliIo,
): Promise<RunResult> {
  try {
    const written = await writeExport(command)
    for (const dest of written) {
      io.log(`wrote ${dest}`)
    }
    return { code: 0 }
  } catch (error) {
    if (isNotFound(error)) {
      io.error(`原稿が見つかりません: ${command.source}`)
      return { code: 1 }
    }
    io.error('export に失敗しました。')
    console.error('[kumihan] Failed to export:', error)
    return { code: 1 }
  }
}

async function runServe(
  command: { source: string; host: string; port: number; title?: string; language?: string },
  io: CliIo,
): Promise<RunResult> {
  try {
    const started = await startPreviewServer(command)
    io.log(`Typeset preview: ${started.url}`)
    io.log(`Two-column preview: ${started.url}/magazine.html`)
    io.log(`Web article preview: ${started.url}/web.html`)
    return { code: 0, close: started.close }
  } catch (error) {
    io.error('プレビューサーバを起動できませんでした。')
    console.error('[kumihan] Failed to start preview server:', error)
    return { code: 1 }
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

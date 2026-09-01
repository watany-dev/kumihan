import { dirname, relative, resolve, sep } from 'node:path'

import { contained } from './manuscript-path.js'

const GIT_TIMEOUT_MS = 5000
const GIT_MAX_BUFFER = 32 * 1024 * 1024

export interface GitTrackedFile {
  /** リポジトリのルート（絶対パス）。 */
  toplevel: string
  /** toplevel からの POSIX 相対パス。 */
  rel: string
}

export interface HeadBlob {
  /** HEAD の blob OID。index にしか無い新規ファイルは空文字。 */
  oid: string
  text: string
}

/**
 * 原稿ファイルが git で追跡されているかを一度探る。失敗したら null。
 *
 * 子プロセスはシェルを介さない。パスに改行や NUL があれば無効。
 */
export async function probeGit(file: string): Promise<GitTrackedFile | null> {
  if (file.includes('\0') || file.includes('\n') || file.includes('\r')) {
    return null
  }

  const abs = resolve(file)
  const cwd = dirname(abs)
  const top = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (top === null) return null

  const toplevel = top.trim()
  if (!contained(toplevel, abs)) {
    return null
  }

  const rel = relative(toplevel, abs).split(sep).join('/')
  const tracked = await git(toplevel, ['ls-files', '--error-unmatch', '--', rel])
  if (tracked === null) return null

  return { toplevel, rel }
}

/**
 * HEAD 時点の本文。index にだけある新規ファイルは oid / text とも空。
 * cat-file がその場で失敗したときは null（案内ページへ倒す）。
 */
export async function readHeadFile(tracked: GitTrackedFile): Promise<HeadBlob | null> {
  const spec = `HEAD:${tracked.rel}`
  const parsed = await git(tracked.toplevel, ['rev-parse', '--verify', '--end-of-options', spec])
  if (parsed === null) {
    return { oid: '', text: '' }
  }

  const oid = parsed.trim()
  const text = await git(tracked.toplevel, ['cat-file', '-p', oid])
  if (text === null) return null
  return { oid, text }
}

function git(cwd: string, args: readonly string[]): Promise<string | null> {
  const { execFile } = process.getBuiltinModule('node:child_process')
  return new Promise((settle) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        encoding: 'utf8',
        shell: false,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error: Error | null, stdout: string) => {
        if (error) {
          settle(null)
          return
        }
        settle(stdout)
      },
    ).stdin?.end()
  })
}

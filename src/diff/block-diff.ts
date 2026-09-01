import { splitSegments } from '../markdown/segments.js'

type DiffKind = 'keep' | 'add' | 'del'

export interface DiffOp {
  kind: DiffKind
  text: string
}

/**
 * 旧区画と新区画の LCS。字面が完全一致したときだけ keep。
 * 空白だけの区画は列から落とす。
 */
export function diffSegments(oldSegs: readonly string[], newSegs: readonly string[]): DiffOp[] {
  const a = oldSegs.filter((segment) => !/^\s*$/.test(segment))
  const b = newSegs.filter((segment) => !/^\s*$/.test(segment))
  const n = a.length
  const m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))

  for (let i = 1; i <= n; i += 1) {
    const row = dp[i]
    const prev = dp[i - 1]
    const older = a[i - 1]
    if (row === undefined || prev === undefined || older === undefined) continue
    for (let j = 1; j <= m; j += 1) {
      const newer = b[j - 1]
      if (newer === undefined) continue
      if (older === newer) {
        row[j] = (prev[j - 1] ?? 0) + 1
      } else {
        const left = row[j - 1] ?? 0
        const up = prev[j] ?? 0
        row[j] = left >= up ? left : up
      }
    }
  }

  const ops: DiffOp[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const older = i > 0 ? a[i - 1] : undefined
    const newer = j > 0 ? b[j - 1] : undefined
    if (older !== undefined && newer !== undefined && older === newer) {
      ops.push({ kind: 'keep', text: older })
      i -= 1
      j -= 1
      continue
    }
    const row = dp[i]
    const prev = i > 0 ? dp[i - 1] : undefined
    const left = j > 0 ? (row?.[j - 1] ?? 0) : -1
    const up = prev?.[j] ?? -1
    if (newer !== undefined && (older === undefined || left >= up)) {
      ops.push({ kind: 'add', text: newer })
      j -= 1
    } else if (older !== undefined) {
      ops.push({ kind: 'del', text: older })
      i -= 1
    } else {
      /* v8 ignore next -- i も j も 0 ならループに入らない */
      break
    }
  }

  ops.reverse()
  return ops
}

/**
 * 最後の区画はファイル末尾の `\n` を含むが、途中の区画は区切りの空行の
 * 手前で切れる。同じ本文のあとに区画を足しただけで keep が外れるのを防ぐ。
 */
function trimSegment(segment: string): string {
  return segment.endsWith('\n') ? segment.slice(0, -1) : segment
}

/**
 * keep はそのまま、連続する del / add は同じ kind の wrapper 1 つにまとめる。
 * 隣接する del ランと add ランは del → add の順（削除が元の位置に残る）。
 */
export function renderBlockDiff(
  oldNormalized: string,
  newNormalized: string,
  renderPiece: (segment: string) => string,
): string {
  return htmlFromOps(
    diffSegments(
      splitSegments(oldNormalized).map(trimSegment),
      splitSegments(newNormalized).map(trimSegment),
    ),
    renderPiece,
  )
}

function htmlFromOps(ops: readonly DiffOp[], renderPiece: (segment: string) => string): string {
  let html = ''
  let i = 0
  while (i < ops.length) {
    const op = ops[i]
    if (op === undefined) break
    if (op.kind === 'keep') {
      html = appendHtml(html, renderPiece(op.text))
      i += 1
      continue
    }

    const kind = op.kind
    const inner: string[] = []
    while (i < ops.length) {
      const next = ops[i]
      if (next === undefined || next.kind !== kind) break
      const piece = renderPiece(next.text)
      if (piece.length > 0) inner.push(piece)
      i += 1
    }
    if (inner.length === 0) continue
    const cls = kind === 'add' ? 'diff-added' : 'diff-removed'
    html = appendHtml(html, `<div class="${cls}">${inner.join('\n')}</div>`)
  }
  return html
}

function appendHtml(html: string, piece: string): string {
  if (piece.length === 0) return html
  return html.length === 0 ? piece : `${html}\n${piece}`
}

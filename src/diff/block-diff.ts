import { splitSegments } from '../markdown/segments.js'
import { splitBlocks } from '../typesetting/paginate.js'

type DiffKind = 'keep' | 'add' | 'del'

export interface DiffOp {
  kind: DiffKind
  text: string
}

function keep(text: string): DiffOp {
  return { kind: 'keep', text }
}

/**
 * 旧区画と新区画の LCS。字面が完全一致したときだけ keep。
 * 空白だけの区画は列から落とす。
 *
 * 表は区画数の積だけ場所を取るので、そのまま組むと大きな原稿で潰れます
 * （区画 2 万どうしで 1.7GB・12 秒。プレビューは差分の GET 1 回で死にます）。
 * 前後の一致を先に外し、残りが大きすぎるときは「まるごと入れ替え」に倒します。
 */
export function diffSegments(oldSegs: readonly string[], newSegs: readonly string[]): DiffOp[] {
  const a = oldSegs.filter((segment) => !/^\s*$/.test(segment))
  const b = newSegs.filter((segment) => !/^\s*$/.test(segment))

  // 保存のたびに走る差分では、変わるのはふつう 1 区画です。前後の一致を
  // 外すだけで、表はその 1 区画ぶんに縮みます。
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) {
    head += 1
  }
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1
  }

  return [
    ...a.slice(0, head).map(keep),
    ...middleOps(a.slice(head, a.length - tail), b.slice(head, b.length - tail)),
    ...b.slice(b.length - tail).map(keep),
  ]
}

/**
 * 表に使ってよい升目の数。1 升 4 バイトなので、ここまでで 16MB・50ms ほど。
 * 超える書き換えは、共通の並びを探さずに「旧を消して新を置く」とします。
 */
const LCS_CELLS = 4_000_000

function middleOps(a: readonly string[], b: readonly string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > LCS_CELLS) {
    return [
      ...a.map((text): DiffOp => ({ kind: 'del', text })),
      ...b.map((text): DiffOp => ({ kind: 'add', text })),
    ]
  }
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
 * keep はそのまま、add / del は各ブロックの開きタグに class を付ける。
 * 隣接する del と add は del → add の順（削除が元の位置に残る）。
 *
 * wrapper にしないのは、頁分けがブロックの境目でしか切れないため。包むと
 * 長い変更が割れない 1 ブロックになり、タグ名での高さ見積りも崩れる。
 */
export function renderBlockDiff(
  oldNormalized: string,
  newNormalized: string,
  renderPiece: (segment: string) => string,
): string {
  const older = splitSegments(oldNormalized).filter(hasContent)
  const newer = splitSegments(newNormalized).filter(hasContent)
  return htmlFromOps(
    diffSegments(older.map(trimSegment), newer.map(trimSegment)),
    older,
    newer,
    renderPiece,
  )
}

function hasContent(segment: string): boolean {
  return !/^\s*$/.test(segment)
}

/**
 * 比べたのは末尾の `\n` を落とした字面ですが、組むのは元の区画です。
 * 閉じていないフェンスでは、その `\n` がコードの中身の一部なので、落とした
 * ままだと差分ビューの最後のコードブロックが通常プレビューより 1 行短く
 * なります。keep と add は今の原稿から、del は HEAD の原稿から取ります。
 */
function htmlFromOps(
  ops: readonly DiffOp[],
  older: readonly string[],
  newer: readonly string[],
  renderPiece: (segment: string) => string,
): string {
  let html = ''
  let from = 0
  let to = 0
  for (const op of ops) {
    const text = op.kind === 'del' ? (older[from] ?? op.text) : (newer[to] ?? op.text)
    if (op.kind !== 'add') from += 1
    if (op.kind !== 'del') to += 1
    const piece = renderPiece(text)
    if (piece.length === 0) continue
    if (op.kind === 'keep') {
      html = appendHtml(html, piece)
      continue
    }
    const cls = op.kind === 'add' ? 'diff-added' : 'diff-removed'
    html = appendHtml(html, markDiffClass(piece, cls))
  }
  return html
}

function markDiffClass(html: string, cls: string): string {
  return splitBlocks(html)
    .map((block) => addClass(block, cls))
    .join('\n')
}

function addClass(block: string, cls: string): string {
  if (block.charCodeAt(0) !== 0x3c) return block
  const gt = block.indexOf('>')
  if (gt <= 0) return block
  return `${block.slice(0, gt)} class="${cls}"${block.slice(gt)}`
}

function appendHtml(html: string, piece: string): string {
  if (piece.length === 0) return html
  return html.length === 0 ? piece : `${html}\n${piece}`
}

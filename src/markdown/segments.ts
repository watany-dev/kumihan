const BACKTICK = 0x60
const NEWLINE = 0x0a

/**
 * start（行頭）から始まる区画の終端を返します。フェンスコードの外にある
 * 最初の空行（`\n\n`）の 1 つ目の `\n` の位置、無ければ text.length。
 *
 * renderLines と同じく「``` で始まる行」がフェンスの開閉を切り替えます。
 * 空行の候補ごとに、そこまでの ``` 行の数の偶奇を数え、奇数（フェンスの中）
 * なら区切りにせず先へ延ばします。走査は区画の中に閉じているので、全体の
 * 走査量は原稿の長さに比例したままです。
 */
export function segmentEnd(text: string, start: number): number {
  let insideFence = isFenceLineAt(text, start)
  let scanned = start
  let cursor = start
  while (true) {
    const boundary = text.indexOf('\n\n', cursor)
    if (boundary === -1) {
      return text.length
    }
    // [scanned, boundary) にある「``` で始まる行」を数えます。2 行目以降の
    // 行頭は `\n` の次なので、`\n` 込みで探せば行頭だけに一致します
    // （1 行目は上の isFenceLineAt が見ています）。
    const window = text.slice(scanned, boundary)
    let at = window.indexOf('\n```')
    while (at !== -1) {
      insideFence = !insideFence
      // 次の一致の `\n` は、いま見つけた行の ``` 3 文字より後ろにしかない。
      at = window.indexOf('\n```', at + 4)
    }
    scanned = boundary
    if (!insideFence) {
      return boundary
    }
    cursor = boundary + 1
  }
}

function isFenceLineAt(text: string, at: number): boolean {
  return (
    text.charCodeAt(at) === BACKTICK &&
    text.charCodeAt(at + 1) === BACKTICK &&
    text.charCodeAt(at + 2) === BACKTICK
  )
}

/**
 * 正規化済みの原稿を、フェンス外の空行で区切った区画に分けます。
 *
 * 増分変換と同じ切り方です。先頭の空行は読み飛ばし、空白だけの区画も
 * 残します（変換すると空になるので、呼び出し側が落とします）。
 */
export function splitSegments(text: string): string[] {
  const segments: string[] = []
  let i = 0
  while (i < text.length) {
    while (text.charCodeAt(i) === NEWLINE) {
      i += 1
    }
    if (i >= text.length) break
    const end = segmentEnd(text, i)
    segments.push(text.slice(i, end))
    i = end + 1
  }
  return segments
}

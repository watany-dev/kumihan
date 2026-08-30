export const MAGAZINE_LINES_PER_PAGE = 40

/**
 * 1段組。A4 本文（297mm − 上下 46mm）に、短い段落（行送り 1.9em + 下余白 0.9em）
 * がおよそ 24 個入る。2段の 40 より小さいのは、字が大きく段もないため。
 */
export const PRINT_LINES_PER_PAGE = 24

/**
 * HTML 断片の改行数で頁に詰める。ブロックの途中では切らない。
 *
 * ponytail: 折り返しや段の高さは見ない。視覚行がずれたら estimate を足す。
 */
export function paginate(html: string, linesPerPage: number): string[] {
  const blocks = splitBlocks(html)
  if (blocks.length === 0) {
    return ['']
  }

  const pages: string[][] = []
  let current: string[] = []
  let used = 0

  for (const block of blocks) {
    const lines = lineCount(block)
    if (current.length > 0 && used + lines > linesPerPage) {
      pages.push(current)
      current = []
      used = 0
    }
    current.push(block)
    used += lines
  }
  pages.push(current)

  return pages.map((page) => page.join('\n'))
}

/**
 * ブロックが組まれる行数。
 *
 * もとは HTML の改行を数えるだけでした。renderMarkdown は組まれる行ごとに
 * 改行を入れるので大半は合いますが、2 方向にずれます。
 *
 * - 数え足りない: `<br>`（行末 2 スペースの強制改行）は改行を作りません。
 *   2 段組の紙は高さが 40 行に固定されているので、詩や住所のように強制改行が
 *   続く原稿は、1 行と数えたまま紙からあふれて消えます。
 * - 数えすぎ: `<ul>` や `<table>` の囲みタグは、それ自体では何も組まれないのに
 *   1 行ずつ数えていました。5 項目の箇条書きが 7 行、3 行の表が 9 行になり、
 *   頁が早く切れて紙が空きます。
 *
 * そこで「その行に組まれる中身があるか」で数えます。地の文か `<img>`・`<hr>` が
 * あれば 1 行、`<br>` はそこで行を終える、囲みタグだけの行は数えません。
 * 折り返しは相変わらず見ません（見るには字幅が要ります）。
 */
function lineCount(html: string): number {
  let lines = 0
  let visible = false
  let inTag = false

  for (let i = 0; i < html.length; i += 1) {
    const code = html.charCodeAt(i)
    if (inTag) {
      if (code === 0x3e) {
        inTag = false
      }
      continue
    }
    if (code === 0x3c) {
      inTag = true
      if (isTag(html, i + 1, 'br')) {
        lines += 1
        visible = false
      } else if (isTag(html, i + 1, 'hr') || isTag(html, i + 1, 'img')) {
        visible = true
      }
      continue
    }
    if (code === 0x0a) {
      if (visible) {
        lines += 1
      }
      visible = false
      continue
    }
    if (code !== 0x20 && code !== 0x09 && code !== 0x0d) {
      visible = true
    }
  }

  if (visible) {
    lines += 1
  }
  // 何も組まれないブロックでも、詰め込みが進むよう 1 行は取ります。
  return lines === 0 ? 1 : lines
}

// `<` の次から始まるタグ名が name かどうか。slice を作らずに比べます。
function isTag(html: string, start: number, name: string): boolean {
  for (let i = 0; i < name.length; i += 1) {
    if ((html.charCodeAt(start + i) | 0x20) !== name.charCodeAt(i)) {
      return false
    }
  }
  const after = html.charCodeAt(start + name.length)
  return after === 0x3e || after === 0x20 || after === 0x2f
}

function splitBlocks(html: string): string[] {
  const blocks: string[] = []
  let i = 0

  while (i < html.length) {
    const code = html.charCodeAt(i)
    if (code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20) {
      i += 1
      continue
    }
    if (code !== 0x3c) {
      const next = html.indexOf('<', i)
      const end = next === -1 ? html.length : next
      const text = html.slice(i, end).trim()
      if (text.length > 0) {
        blocks.push(text)
      }
      i = end
      continue
    }
    const end = elementEnd(html, i)
    blocks.push(html.slice(i, end))
    i = end
  }

  return blocks
}

function elementEnd(html: string, start: number): number {
  const gt = html.indexOf('>', start)
  if (gt === -1) {
    return html.length
  }
  const name = tagName(html, start + 1)
  if (
    name.length === 0 ||
    name === 'hr' ||
    name === 'br' ||
    name === 'img' ||
    html.charCodeAt(gt - 1) === 0x2f
  ) {
    return gt + 1
  }

  const open = `<${name}`
  const close = `</${name}>`
  let depth = 1
  let i = gt + 1
  while (depth > 0) {
    const nextClose = html.indexOf(close, i)
    if (nextClose === -1) {
      return html.length
    }
    const nextOpen = html.indexOf(open, i)
    if (nextOpen !== -1 && nextOpen < nextClose && isNameEnd(html, nextOpen + open.length)) {
      depth += 1
      i = nextOpen + open.length
      continue
    }
    depth -= 1
    i = nextClose + close.length
  }
  return i
}

function tagName(html: string, from: number): string {
  let i = from
  if (html.charCodeAt(i) === 0x2f) {
    i += 1
  }
  const first = html.charCodeAt(i) | 0x20
  if (first < 0x61 || first > 0x7a) {
    return ''
  }
  const start = i
  i += 1
  while (i < html.length) {
    const c = html.charCodeAt(i)
    const lower = c | 0x20
    if ((lower < 0x61 || lower > 0x7a) && (c < 0x30 || c > 0x39)) {
      break
    }
    i += 1
  }
  return html.slice(start, i).toLowerCase()
}

function isNameEnd(html: string, index: number): boolean {
  const c = html.charCodeAt(index)
  return c === 0x3e || c === 0x20 || c === 0x2f || c === 0x0a || c === 0x09 || c === 0x0d
}

/**
 * 頁の寸法。行数は段の合計で、字数は段 1 本ぶん。
 *
 * 数字は typeset.css の指定から割り出します。両者がずれると頁があふれるので、
 * test/paginate.test.ts が組版指定との一致を確かめます。
 */
export interface PageLayout {
  /** 1 頁に組める本文行数。2段組は 2 段ぶんの合計。 */
  readonly lines: number
  /** 段 1 本の 1 行に入る全角文字の数。 */
  readonly columnChars: number
  /** 段の数。1 本ぶんの高さは lines をこれで割った値。 */
  readonly columns: number
  /** 本文の級数（pt）。見出しなど pt 指定の要素を本文行に換算するのに使う。 */
  readonly bodyPoints: number
  /** 本文の行送り（font-size に対する倍率）。 */
  readonly lineHeight: number
  /** 版面の幅（mm）。段抜きの図はここまで広がる。 */
  readonly textWidthMm: number
  /** 段 1 本の幅（mm）。段の中に組まれる図はここまで。 */
  readonly columnWidthMm: number
}

const MM_PER_POINT = 0.352778

// .paper の紙と余白。版面はこれを引いた残り。
const PAPER_WIDTH_MM = 210
const PAPER_HEIGHT_MM = 297
const PAPER_PAD_TOP_MM = 22
const PAPER_PAD_SIDE_MM = 20
const PAPER_PAD_BOTTOM_MM = 24

const TEXT_WIDTH_MM = PAPER_WIDTH_MM - PAPER_PAD_SIDE_MM * 2
const TEXT_HEIGHT_MM = PAPER_HEIGHT_MM - PAPER_PAD_TOP_MM - PAPER_PAD_BOTTOM_MM

// .typeset の本文。
const PRINT_POINTS = 10.5
const PRINT_LINE_HEIGHT = 1.9

// .typeset.cols-2 の本文と段。段の高さは CSS が min-height で決めています。
const MAGAZINE_POINTS = 9.5
const MAGAZINE_LINE_HEIGHT = 1.75
const MAGAZINE_COLUMNS = 2
const MAGAZINE_GAP_MM = 8
const MAGAZINE_COLUMN_WIDTH_MM =
  (TEXT_WIDTH_MM - MAGAZINE_GAP_MM * (MAGAZINE_COLUMNS - 1)) / MAGAZINE_COLUMNS
/** 2段組の段 1 本の高さ（行）。typeset.css の min-height と同じ値。 */
export const MAGAZINE_COLUMN_LINES = 40

/** 段 1 本に入る全角文字の数。全角は級数と同じ幅で組まれる。 */
function columnChars(widthMm: number, points: number): number {
  return Math.floor(widthMm / (points * MM_PER_POINT))
}

/** 版面に入る行数。 */
function pageLines(heightMm: number, points: number, lineHeight: number): number {
  return Math.floor(heightMm / (points * lineHeight * MM_PER_POINT))
}

/**
 * 1段組。A4 の版面 170×251mm に、10.5pt・行送り 1.9 で 35 行、1 行 45 字。
 */
export const PRINT_LAYOUT: PageLayout = {
  lines: pageLines(TEXT_HEIGHT_MM, PRINT_POINTS, PRINT_LINE_HEIGHT),
  columnChars: columnChars(TEXT_WIDTH_MM, PRINT_POINTS),
  columns: 1,
  bodyPoints: PRINT_POINTS,
  lineHeight: PRINT_LINE_HEIGHT,
  textWidthMm: TEXT_WIDTH_MM,
  columnWidthMm: TEXT_WIDTH_MM,
}

/**
 * 2段組。段の幅は (170 − 8) ÷ 2 = 81mm で、9.5pt なら 1 行 24 字。
 * 高さは CSS が段 1 本 40 行に決めているので、頁の容量はその 2 段ぶん。
 */
export const MAGAZINE_LAYOUT: PageLayout = {
  lines: MAGAZINE_COLUMN_LINES * MAGAZINE_COLUMNS,
  columnChars: columnChars(MAGAZINE_COLUMN_WIDTH_MM, MAGAZINE_POINTS),
  columns: MAGAZINE_COLUMNS,
  bodyPoints: MAGAZINE_POINTS,
  lineHeight: MAGAZINE_LINE_HEIGHT,
  textWidthMm: TEXT_WIDTH_MM,
  columnWidthMm: MAGAZINE_COLUMN_WIDTH_MM,
}

// 同じ断片は組版と 2段の両方が頁分けします。書き出しは必ず両方を作り、
// プレビューもモードを切り替えるたびに同じ断片で来ます。ブロック分割は
// 頁の寸法によらないので断片ごとに一度だけ行い、行数は寸法ごとに覚えます。
// 比較は同一の文字列オブジェクトなら一瞬で、たまたま別オブジェクトでも
// 走査 1 回ぶんより高くつきません。
interface CountCache {
  columnChars: number
  columns: number
  bodyPoints: number
  lineHeight: number
  counts: number[]
  flows: number[]
}

let cachedHtml: string | null = null
let cachedBlocks: string[] = []
const cachedCounts: CountCache[] = []

function blocksOf(html: string, layout: PageLayout): CountCache & { blocks: string[] } {
  if (html !== cachedHtml) {
    cachedHtml = html
    cachedBlocks = splitBlocks(html)
    cachedCounts.length = 0
  }

  for (const entry of cachedCounts) {
    if (
      entry.columnChars === layout.columnChars &&
      entry.columns === layout.columns &&
      entry.bodyPoints === layout.bodyPoints &&
      entry.lineHeight === layout.lineHeight
    ) {
      return { ...entry, blocks: cachedBlocks }
    }
  }

  const counts: number[] = []
  const flows: number[] = []
  let previous = ''
  for (const block of cachedBlocks) {
    const tag = tagNameOf(block)
    // 隣り合う余白は重なります（margin collapsing）。足し合わせたままだと、
    // 見出しや引用のたびに 0.5 行ずつ多く見積もり、紙の下が空きます。
    //
    // 引くのは 1段組だけです。2段組は段の変わり目で余白が重ならないうえ、
    // 詰め込みが見ていない空き（`widows` / `orphans` の 2 行、段をまたげない
    // ブロックが次の段へ送られたあとの残り）がそのぶんあります。Chromium で
    // 測ると、重なりを当てにした 2段の頁は段 1 本 40 行のところ 43 行に組まれ、
    // 紙からはみ出しました。重なるぶんはその空きに充てます。
    // 最初のブロックは previous が空で、重なりはそのまま 0 になります。
    const overlap = layout.columns > 1 ? 0 : collapsedLead(previous, tag, layout)
    counts.push(blockLines(block, layout) - overlap)
    flows.push(flowOf(tag, block, previous, layout))
    previous = tag
  }

  // 覚えるのは組版と 2段のぶんだけ。それ以上は古いものから捨てます。
  const entry: CountCache = {
    columnChars: layout.columnChars,
    columns: layout.columns,
    bodyPoints: layout.bodyPoints,
    lineHeight: layout.lineHeight,
    counts,
    flows,
  }
  cachedCounts.push(entry)
  if (cachedCounts.length > 2) {
    cachedCounts.shift()
  }
  return { ...entry, blocks: cachedBlocks }
}

/**
 * HTML 断片を頁に詰める。ブロックの途中では切らない。
 *
 * 詰め込みは段をひとつずつ埋めていく形で数えます。ブロックの高さを足して
 * 頁の行数と比べるだけでは、2段組で紙があふれました。表とコードは
 * `break-inside: avoid` で段をまたげないので、段の終わりに入りきらないと
 * まるごと次の段へ送られ、空いた行がそのぶん無駄になります。段抜きの見出しや
 * コードも、その前後で段を分けます。空く行は原稿しだいで頁の 2 割にもなり、
 * 足し算だけの見積りでは埋め合わせられません。
 *
 * 紙を確定させる前に、末尾を見て泣き別れを直します（`withoutTrailingHeading`）。
 */
export function paginate(html: string, layout: PageLayout): string[] {
  const { blocks, counts, flows } = blocksOf(html, layout)
  if (blocks.length === 0) {
    return ['']
  }

  const pages: string[] = []
  let start = 0
  while (start < blocks.length) {
    let end = pageEnd(counts, flows, start, layout)
    // 最後の紙には送り先がありません。見出しだけの紙を作らないよう、そのまま置きます。
    if (end < blocks.length) {
      end = withoutTrailingHeading(flows, start, end)
    }
    pages.push(joinBlocks(blocks, start, end))
    start = end
  }

  return pages
}

/**
 * start から詰めて、次の紙へ回る最初のブロックの位置を返す。
 * 全部入るなら blocks の数（= counts の数）。
 */
function pageEnd(
  counts: readonly number[],
  flows: readonly number[],
  start: number,
  layout: PageLayout,
): number {
  const columns = layout.columns
  const columnLines = layout.lines / columns

  // 段抜きは段組みを区切ります。closed は区切り済みの高さ、heights と kinds は
  // いま積んでいる区画のブロック。
  const heights: number[] = []
  const kinds: number[] = []
  let closed = 0

  for (let index = start; index < counts.length; index += 1) {
    const height = counts[index] ?? 1
    const flow = flows[index] ?? FLOW_NORMAL

    if (flow === FLOW_SPAN || flow === FLOW_SPAN_WITH_NEXT) {
      // 段抜きは区画を閉じ、その下に自分の高さぶんを取ります。段を抜く見出しが
      // 紙の末尾に来たときは、withoutTrailingHeading が次の紙へ送ります。
      const level = closed + regionHeight(heights, kinds, columns)
      if (index > start && level + height > columnLines) {
        return index
      }
      closed = level + height
      heights.length = 0
      kinds.length = 0
    } else {
      heights.push(height)
      kinds.push(flow)
      if (index > start && !fitsInColumns(heights, kinds, columns, columnLines - closed)) {
        return index
      }
    }
  }

  return counts.length
}

/**
 * blocks の [from, to) を改行でつなぐ。
 *
 * `blocks.slice(from, to).join('\n')` なら 1 行ですが、紙ごとに配列を 1 つ捨てます。
 * `content/index.md` の 40 倍（50 頁）で頁分けは 0.09ms から 0.16ms になり、
 * 変換から組み上げまで（0.44ms）の 2 割近くを占めました。頁は文字列のまま積みます。
 */
function joinBlocks(blocks: readonly string[], from: number, to: number): string {
  let page = blocks[from] ?? ''
  for (let i = from + 1; i < to; i += 1) {
    page += `\n${blocks[i]}`
  }
  return page
}

/**
 * 紙の末尾に残った見出しを次の紙へ送る。
 *
 * 見出しは `break-after: avoid` ですが、頁を切っているのは CSS ではなく
 * ここなので、紙に分けたあとでは働く余地がありません。詰め込みは見出しの
 * 直後に 1 行ぶんの空きを取ってはいますが、続くのが 1 行では済まないブロック
 * ——長い段落、表、コード——なら、そのブロックだけが次の紙へ回り、見出しが
 * 紙の最終行に取り残されます。
 *
 * 見出しが続くとき（章の見出しと節の見出し）はまとめて送ります。ただし紙が
 * 空になる送りはしません。送り先の紙も先頭から詰め直すので、送ったぶんが
 * また末尾に来ることはありません。
 */
function withoutTrailingHeading(flows: readonly number[], start: number, end: number): number {
  let last = end
  while (last - 1 > start && keepsWithNext(flows[last - 1] ?? FLOW_NORMAL)) {
    last -= 1
  }
  return last
}

/**
 * 高さ height の段が columns 本あるとき、ブロックがそこに収まるか。
 *
 * 地の文は段をまたいで流れ、`break-inside: avoid` のブロックはまたげません。
 * またげないブロックが段の終わりに入りきらないと、まるごと次の段へ送られ、
 * 空いた行はそのまま無駄になります。見出しは `break-after: avoid` なので、
 * 続く 1 行ぶんの空きも同じ段に要ります。
 *
 * 段 1 本にも収まらない塊は「収まらない」と答えます。呼ぶ側は空の頁には
 * 必ず 1 つ置くので、そういう塊は自分だけの頁を取ってはみ出します。
 */
function fitsInColumns(
  heights: readonly number[],
  kinds: readonly number[],
  columns: number,
  height: number,
): boolean {
  if (height <= 0) {
    return false
  }

  let column = 0
  let used = 0
  for (let i = 0; i < heights.length; i += 1) {
    const block = heights[i] ?? 0
    const kind = kinds[i] ?? FLOW_NORMAL
    if (kind !== FLOW_NORMAL) {
      // 見出しは直後の 1 行も連れるので、そのぶんの空きも見ます。
      const needed = keepsWithNext(kind) ? block + 1 : block
      if (used > 0 && used + needed > height) {
        column += 1
        used = 0
        if (column >= columns) {
          return false
        }
      }
      used += block
      if (used > height) {
        return false
      }
      continue
    }

    let rest = block
    while (rest > 0) {
      const space = height - used
      if (space <= 0) {
        column += 1
        used = 0
        if (column >= columns) {
          return false
        }
        continue
      }
      const take = rest < space ? rest : space
      used += take
      rest -= take
    }
  }
  return true
}

/**
 * 区画が組まれる高さ。`column-fill: balance` は中身を段へ均等に割るので、
 * 地の文だけなら合計を段の数で割った値です。段をまたげないブロックがあると
 * 均等には割れないので、収まる高さのうちいちばん低いものを探します。
 */
function regionHeight(
  heights: readonly number[],
  kinds: readonly number[],
  columns: number,
): number {
  let sum = 0
  let tallest = 0
  for (let i = 0; i < heights.length; i += 1) {
    const block = heights[i] ?? 0
    sum += block
    if ((kinds[i] ?? FLOW_NORMAL) !== FLOW_NORMAL && block > tallest) {
      tallest = block
    }
  }

  const balanced = sum / columns
  if (tallest === 0 || columns === 1) {
    return balanced
  }

  // 均等割りでは収まらないことがある。収まる高さを二分探索する。
  // 段をまたげないブロックはそれ自体が段に入る必要があるので、いちばん高い
  // ものが下限。1 本に積み上げた高さ（sum）なら必ず収まるので、そこが上限。
  let low = balanced > tallest ? balanced : tallest
  let high = sum
  if (high <= low) {
    return low
  }
  while (high - low > REGION_PRECISION) {
    const middle = (low + high) / 2
    if (fitsInColumns(heights, kinds, columns, middle)) {
      high = middle
    } else {
      low = middle
    }
  }
  return high
}

// 二分探索を止める幅。行の 100 分の 1 まで合えば、頁の詰まり方は変わらない。
const REGION_PRECISION = 0.01

// ===== 組み上がりの見積り =====
//
// もとは HTML の改行を数えるだけでした。renderMarkdown は組まれる行ごとに
// 改行を入れるので「1 行の段落」は当たりますが、日本語の原稿は 1 つの段落を
// 1 行に書くのがふつうで、折り返しはブラウザに任せます。300 字の段落は
// 2段組の 24 字の段では 13 行に組まれるのに、1 行と数えていました。
//
// 数え違いは 2段組で紙を壊します。段の高さは CSS で決まっているので、入り
// きらない中身は段の右外に「あふれ段」として並び、紙の外にはみ出して切れます。
// そこで、折り返し・前後の余白・段抜きまで見て、組まれる高さを本文行で数えます。
//
// 字幅は全角 1em・半角 0.5em として、半角ぶんを 1 とする整数で測ります。実際の
// 字送りは書体で変わるので、これは見当です。見当が外れても紙が壊れないよう、
// typeset.css は段の高さを min-height で持ち、あふれた頁は横に流さず縦に伸ばします。
//
// 画像は実寸から見積もります。断片の `<img>` に width / height が入っていれば
// （`measure-images.ts` が原稿の画像ファイルから読んで書き入れます）、CSS の
// max-width / max-height で縮んだあとの高さを本文行に直します。寸法の分からない
// 画像 —— 外部の URL や、読めなかったファイル —— は従来どおり 1 行と数えます。

/** 半角 1 字を 1 とする幅の単位。全角はこの 2 つぶん。 */
const HALF = 1
const FULL = 2

// typeset.css の寸法。単位のない数は em（その要素の級数基準）。
const PARAGRAPH_MARGIN_EM = 0.9
const HEADING_LINE_HEIGHT = 1.45
const H1_POINTS = 18
const H1_MARGIN_BOTTOM_EM = 1.1
const H1_LETTER_SPACING_EM = 0.06
const H2_POINTS = 13.5
const H2_MARGIN_TOP_EM = 1.8
const H2_MARGIN_BOTTOM_EM = 0.7
// 下罫の手前の詰め。padding は余白と違って重ならないので、別に数えます。
const H2_PADDING_EM = 0.28
const H3_POINTS = 12
const H3_MARGIN_TOP_EM = 1.5
const H3_MARGIN_BOTTOM_EM = 0.5
const LIST_MARGIN_EM = 0.9
const LIST_INDENT_EM = 1.5
// 隣り合う項目の margin は重なるので、項目ごとに数えるのは片側だけ。
const LIST_ITEM_MARGIN_EM = 0.15
const QUOTE_MARGIN_EM = 1.2
const QUOTE_PADDING_EM = 0.15 + 0.15
const QUOTE_INDENT_EM = 0.4 + 1
const QUOTE_ITEM_MARGIN_EM = 0.9
const CODE_RATIO = 0.92
const CODE_LINE_HEIGHT = 1.6
const CODE_MARGIN_EM = 1.1
const CODE_PADDING_EM = 1 + 1
const CODE_INDENT_EM = 1.1 + 1.1
const TABLE_RATIO = 0.95
const TABLE_MARGIN_EM = 1.1
const CELL_PADDING_Y_EM = 0.35 + 0.35
const CELL_PADDING_X_EM = 0.65 + 0.65
const RULE_MARGIN_EM = 2

// 等幅の半角は本文の半角より広い。字送りは書体しだいだが、おおむね 0.6em。
const MONOSPACE_WIDTH = 1.2

/** ブロックの組み上がり。すべて本文行を単位にする。 */
interface BlockMetrics {
  /** 本文に対する字の大きさ。1 行に入る字数はこれで割る。 */
  fontRatio: number
  /** 組まれる 1 行が本文行いくつぶんか。 */
  lineRatio: number
  /** 段から削られる幅（本文 em）。 */
  indentEm: number
  /** ブロックの上の余白。前のブロックの下の余白と重なる。 */
  leadTop: number
  /** ブロックの下の余白。 */
  leadBottom: number
  /** 上下の詰め（padding・罫）。余白と違って重ならない。 */
  pad: number
  /** 行のまとまり（箇条書きの項目、引用の段落）ごとの余白。 */
  runLead: number
}

/** em を本文行に直す。points はその em の基準になる級数。 */
function toLines(em: number, points: number, layout: PageLayout): number {
  return (em * points) / (layout.bodyPoints * layout.lineHeight)
}

/** 地の文と同じ字と行送りで組まれるブロックの、余白だけが違う見積り。 */
function plain(overrides: Partial<BlockMetrics>): BlockMetrics {
  return {
    fontRatio: 1,
    lineRatio: 1,
    indentEm: 0,
    leadTop: 0,
    leadBottom: 0,
    pad: 0,
    runLead: 0,
    ...overrides,
  }
}

function heading(
  points: number,
  marginTopEm: number,
  marginBottomEm: number,
  paddingEm: number,
  letterSpacingEm: number,
  layout: PageLayout,
): BlockMetrics {
  return plain({
    fontRatio: (points / layout.bodyPoints) * (1 + letterSpacingEm),
    lineRatio: toLines(HEADING_LINE_HEIGHT, points, layout),
    leadTop: toLines(marginTopEm, points, layout),
    leadBottom: toLines(marginBottomEm, points, layout),
    pad: toLines(paddingEm, points, layout),
  })
}

function metricsOf(tag: string, layout: PageLayout): BlockMetrics {
  const body = layout.bodyPoints
  switch (tag) {
    case 'h1':
      return heading(H1_POINTS, 0, H1_MARGIN_BOTTOM_EM, 0, H1_LETTER_SPACING_EM, layout)
    case 'h2':
      return heading(H2_POINTS, H2_MARGIN_TOP_EM, H2_MARGIN_BOTTOM_EM, H2_PADDING_EM, 0, layout)
    case 'h3':
      return heading(H3_POINTS, H3_MARGIN_TOP_EM, H3_MARGIN_BOTTOM_EM, 0, 0, layout)
    case 'p':
      return plain({ leadBottom: toLines(PARAGRAPH_MARGIN_EM, body, layout) })
    case 'ul':
    case 'ol':
      return plain({
        indentEm: LIST_INDENT_EM,
        leadBottom: toLines(LIST_MARGIN_EM, body, layout),
        runLead: toLines(LIST_ITEM_MARGIN_EM, body, layout),
      })
    case 'blockquote':
      return plain({
        indentEm: QUOTE_INDENT_EM,
        leadTop: toLines(QUOTE_MARGIN_EM, body, layout),
        // 引用の最後の段落は `p:last-child` で下の余白を持ちません。段落ごとに
        // 数えたぶんから、その 1 つぶんを引いておきます。
        leadBottom: toLines(QUOTE_MARGIN_EM - QUOTE_ITEM_MARGIN_EM, body, layout),
        pad: toLines(QUOTE_PADDING_EM, body, layout),
        runLead: toLines(QUOTE_ITEM_MARGIN_EM, body, layout),
      })
    case 'pre':
      return plain({
        fontRatio: CODE_RATIO * MONOSPACE_WIDTH,
        lineRatio: toLines(CODE_LINE_HEIGHT, CODE_RATIO * body, layout),
        indentEm: CODE_INDENT_EM * CODE_RATIO,
        leadBottom: toLines(CODE_MARGIN_EM, CODE_RATIO * body, layout),
        pad: toLines(CODE_PADDING_EM, CODE_RATIO * body, layout),
      })
    case 'table':
      return plain({
        fontRatio: TABLE_RATIO,
        lineRatio: toLines(layout.lineHeight, TABLE_RATIO * body, layout),
        leadBottom: toLines(TABLE_MARGIN_EM, TABLE_RATIO * body, layout),
        runLead: toLines(CELL_PADDING_Y_EM, TABLE_RATIO * body, layout),
      })
    case 'hr':
      // 罫そのものは 0.4pt で、高さは上下の余白がほとんど。行は取りません。
      return plain({
        lineRatio: 0,
        leadTop: toLines(RULE_MARGIN_EM, body, layout),
        leadBottom: toLines(RULE_MARGIN_EM, body, layout),
      })
    default:
      return plain({})
  }
}

/**
 * 上下に並ぶブロックで重なる余白（本文行）。
 *
 * 上のブロックの下の余白と、下のブロックの上の余白は、CSS では重なって
 * 大きいほうだけが残ります（margin collapsing）。引き方は blocksOf を見てください。
 */
function collapsedLead(previousTag: string, tag: string, layout: PageLayout): number {
  const above = metricsOf(previousTag, layout).leadBottom
  const below = metricsOf(tag, layout).leadTop
  return above < below ? above : below
}

/**
 * ブロック 1 つの、段 1 本ぶんの組み上がりの高さ（本文行）。
 * 見当の当たり外れは頁の詰まり具合にそのまま出るので、テストが実寸と比べます。
 */
export function blockLines(block: string, layout: PageLayout): number {
  const tag = tagNameOf(block)
  const metrics = metricsOf(tag, layout)

  // 1 行に入る幅。全角 1 字を FULL として測るので、段の字数もその単位に直す。
  const capacity = Math.max(
    FULL,
    (FULL * (layout.columnChars - metrics.indentEm)) / metrics.fontRatio,
  )

  const counted = tag === 'table' ? tableRuns(block, capacity) : textRuns(block, capacity)
  const height =
    metrics.leadTop +
    metrics.leadBottom +
    metrics.pad +
    counted.lines * metrics.lineRatio +
    counted.runs * metrics.runLead +
    imageExtraLines(block, layout)

  // 何も組まれないブロックでも、詰め込みが進むよう 1 行は取ります。
  return height > 0 ? height : 1
}

// ===== 画像 =====
//
// 画像の実寸は CSS ピクセルで、1px は 1/96 インチです。原稿に対して原寸で
// 組む必要はないので、typeset.css は幅を版面（または段）まで、高さを段 1 本
// までに抑えます。大きな写真はそこまで縮み、小さな図はそのままの大きさです。
const MM_PER_PIXEL = 25.4 / 96

/** 本文 1 行の高さ（mm）。 */
function lineMm(layout: PageLayout): number {
  return layout.bodyPoints * layout.lineHeight * MM_PER_POINT
}

/**
 * typeset.css の `img { max-height }` にあたる高さ（本文行）。
 *
 * 段 1 本から段落の下の余白を引いた高さです。ここまで縮めておけば、図だけの
 * 段落は余白を足しても段 1 本にちょうど収まり、頁からはみ出しません。
 */
export function imageMaxLines(layout: PageLayout): number {
  return layout.lines / layout.columns - PARAGRAPH_MARGIN_EM / layout.lineHeight
}

/**
 * ブロックの中の画像が、地の文として数えた 1 行より高いぶん（本文行）。
 *
 * 画像は `<img>` 1 つで 1 行ぶん数えられているので、その差だけを足します。
 * 寸法の無い画像は 0 です（従来どおり 1 行のまま）。
 */
function imageExtraLines(block: string, layout: PageLayout): number {
  let start = block.indexOf('<img')
  if (start === -1) {
    return 0
  }

  // 2段組で段を抜く図（図だけの段落）は版面いっぱいまで、それ以外は段の幅まで。
  const widthMm =
    layout.columns > 1 && isImageParagraph(block) ? layout.textWidthMm : layout.columnWidthMm

  let extra = 0
  while (start !== -1) {
    const end = block.indexOf('>', start)
    if (end === -1) {
      break
    }
    const lines = imageLines(block.slice(start, end + 1), widthMm, layout)
    if (lines > 1) {
      extra += lines - 1
    }
    start = block.indexOf('<img', end + 1)
  }
  return extra
}

/**
 * `<img>` 1 つの組み上がりの高さ（本文行）。寸法が読めなければ 1 行。
 *
 * 幅が入る場所を超えていれば縦横比のまま縮め（`max-width: 100%`）、それでも
 * 段より高ければ高さで抑えます（`max-height`）。
 */
function imageLines(tag: string, widthMm: number, layout: PageLayout): number {
  const width = attributeNumber(tag, ' width="')
  const height = attributeNumber(tag, ' height="')
  if (width <= 0 || height <= 0) {
    return 1
  }

  const drawnMm = Math.min(width * MM_PER_PIXEL, widthMm)
  const lines = (drawnMm * height) / width / lineMm(layout)
  const max = imageMaxLines(layout)
  return lines > max ? max : lines
}

/** タグの属性の数。` width="1200"` のように、名前は前後まで含めて渡します。 */
function attributeNumber(tag: string, name: string): number {
  const start = tag.indexOf(name)
  if (start === -1) {
    return 0
  }
  const from = start + name.length
  const end = tag.indexOf('"', from)
  if (end === -1) {
    return 0
  }
  const value = Number(tag.slice(from, end))
  return Number.isFinite(value) ? value : 0
}

// ブロックが段をどう流れるか。
/** 段をまたいで流れる（地の文）。 */
const FLOW_NORMAL = 0
/** 段をまたげない（`break-inside: avoid` の表とコード）。 */
const FLOW_KEEP = 1
/** 段をまたげず、直後の 1 行も連れる（`break-after: avoid` の見出し）。 */
const FLOW_KEEP_WITH_NEXT = 2
/** すべての段を横切る（`column-span: all`）。 */
const FLOW_SPAN = 3
/** すべての段を横切り、直後の 1 行も連れる（段を抜く見出し）。 */
const FLOW_SPAN_WITH_NEXT = 4

/** 直後の 1 行と離れられないブロック（`break-after: avoid` の見出し）か。 */
function keepsWithNext(flow: number): boolean {
  return flow === FLOW_KEEP_WITH_NEXT || flow === FLOW_SPAN_WITH_NEXT
}

/**
 * typeset.css の break-inside / break-after / column-span を、
 * 段への詰め込み方に読み替えます。段抜きは 2段組のときだけです。
 */
function flowOf(tag: string, block: string, previousTag: string, layout: PageLayout): number {
  const spans = layout.columns > 1
  switch (tag) {
    case 'h1':
      return spans ? FLOW_SPAN_WITH_NEXT : FLOW_KEEP_WITH_NEXT
    case 'h2':
    case 'h3':
      return FLOW_KEEP_WITH_NEXT
    case 'pre':
      return spans ? FLOW_SPAN : FLOW_KEEP
    case 'hr':
      return spans ? FLOW_SPAN : FLOW_NORMAL
    case 'table':
      return FLOW_KEEP
    case 'p':
      return spans && (previousTag === 'h1' || isImageParagraph(block)) ? FLOW_SPAN : FLOW_NORMAL
    default:
      return FLOW_NORMAL
  }
}

interface Counted {
  /** 組まれる行数。 */
  lines: number
  /** 行のまとまりの数（`<br>` と改行で区切られる）。 */
  runs: number
}

/** 幅 width の地の文が capacity の行に何行で組まれるか。 */
function wrapped(width: number, capacity: number): number {
  const lines = Math.ceil(width / capacity)
  return lines > 1 ? lines : 1
}

/**
 * ブロックの地の文を、折り返し込みで数える。
 *
 * 囲みタグ（`<ul>` や `<table>`）だけの行は何も組まれないので数えません。
 * `<br>`（行末 2 スペースの強制改行）と改行は、そこで行を終えます。
 */
function textRuns(html: string, capacity: number): Counted {
  let lines = 0
  let runs = 0
  let width = 0
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
        if (visible) {
          lines += wrapped(width, capacity)
          runs += 1
        }
        width = 0
        visible = false
      } else if (isTag(html, i + 1, 'hr') || isTag(html, i + 1, 'img')) {
        // どちらもその行に何か組まれる。画像が 1 行より高いぶんは、
        // 幅も高さも分かってはじめて出るので imageExtraLines が足します。
        visible = true
      }
      continue
    }
    if (code === 0x0a) {
      if (visible) {
        lines += wrapped(width, capacity)
        runs += 1
      }
      width = 0
      visible = false
      continue
    }
    if (code === 0x26) {
      const end = entityEnd(html, i)
      if (end !== -1) {
        width += HALF
        visible = true
        i = end
        continue
      }
    }
    if (code === 0x20 || code === 0x09 || code === 0x0d) {
      // 行頭に寄せられる空白は幅を取らない。
      if (visible) {
        width += HALF
      }
      continue
    }
    width += charWidth(code)
    visible = true
  }

  if (visible) {
    lines += wrapped(width, capacity)
    runs += 1
  }
  return { lines, runs }
}

/**
 * 表の組み上がり。列の幅は、その列でいちばん長いセルの比で分け合うものとする
 * （幅の足りない表をブラウザが組むときのふるまいに近い）。行の高さは、その行で
 * いちばん多く折り返したセルで決まる。
 */
function tableRuns(html: string, capacity: number): Counted {
  const rows = tableCells(html)
  if (rows.length === 0) {
    return textRuns(html, capacity)
  }

  let columns = 0
  for (const row of rows) {
    if (row.length > columns) {
      columns = row.length
    }
  }

  const widest: number[] = Array.from({ length: columns }, () => 0)
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 1) {
      const cell = row[i] ?? 0
      if (cell > (widest[i] ?? 0)) {
        widest[i] = cell
      }
    }
  }

  let total = 0
  for (const width of widest) {
    total += width
  }

  // 枠と余白のぶんは、どの列からも先に引かれる。
  const usable = Math.max(capacity - columns * FULL * CELL_PADDING_X_EM, columns * FULL)
  let lines = 0
  for (const row of rows) {
    let tallest = 1
    for (let i = 0; i < row.length; i += 1) {
      const cell = row[i] ?? 0
      const share = total > 0 ? (usable * (widest[i] ?? 0)) / total : usable / columns
      const height = wrapped(cell, Math.max(share, FULL))
      if (height > tallest) {
        tallest = height
      }
    }
    lines += tallest
  }
  return { lines, runs: rows.length }
}

/** 表の各行の、セルごとの地の文の幅。 */
function tableCells(html: string): number[][] {
  const rows: number[][] = []
  let row: number[] | null = null
  let cellStart = -1
  let i = 0

  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) break
    const gt = html.indexOf('>', lt)
    if (gt === -1) break

    const closing = html.charCodeAt(lt + 1) === 0x2f
    const nameStart = closing ? lt + 2 : lt + 1
    const nameEnd = tagNameEnd(html, nameStart)

    if (isName(html, nameStart, nameEnd, 'tr')) {
      if (row !== null) {
        rows.push(row)
      }
      row = closing ? null : []
      cellStart = -1
    } else if (isName(html, nameStart, nameEnd, 'td') || isName(html, nameStart, nameEnd, 'th')) {
      if (closing) {
        if (row !== null && cellStart !== -1) {
          row.push(spanWidth(html, cellStart, lt))
          cellStart = -1
        }
      } else if (row !== null) {
        cellStart = gt + 1
      }
    }
    i = gt + 1
  }

  if (row !== null) {
    rows.push(row)
  }
  return rows
}

/** html の [from, to) にある地の文の幅。タグの中身は数えない。 */
function spanWidth(html: string, from: number, to: number): number {
  let width = 0
  let inTag = false
  for (let i = from; i < to; i += 1) {
    const code = html.charCodeAt(i)
    if (inTag) {
      if (code === 0x3e) {
        inTag = false
      }
      continue
    }
    if (code === 0x3c) {
      inTag = true
      continue
    }
    if (code === 0x26) {
      const end = entityEnd(html, i)
      if (end !== -1 && end < to) {
        width += HALF
        i = end
        continue
      }
    }
    if (code === 0x0a || code === 0x0d || code === 0x09) {
      continue
    }
    width += charWidth(code)
  }
  return width
}

/**
 * 全角として組まれる符号位置（East Asian Wide / Fullwidth）。半角は 1、全角は 2。
 * サロゲート対は先頭で 2 を数え、続きの 1 つは数えません。
 */
function charWidth(code: number): number {
  if (code < 0x1100) {
    return HALF
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    return 0
  }
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xd800 && code <= 0xdbff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return FULL
  }
  return HALF
}

// `&` から始まる実体参照の `;` の位置。参照でなければ -1。組まれるのは 1 字。
const ENTITY_MAX = 10

function entityEnd(html: string, start: number): number {
  const limit = Math.min(start + ENTITY_MAX, html.length)
  for (let i = start + 1; i < limit; i += 1) {
    const code = html.charCodeAt(i)
    if (code === 0x3b) {
      return i > start + 1 ? i : -1
    }
    if (code === 0x20 || code === 0x3c || code === 0x26) {
      return -1
    }
  }
  return -1
}

/** ブロックの先頭のタグ名（小文字）。タグで始まらなければ空文字。 */
function tagNameOf(block: string): string {
  if (block.charCodeAt(0) !== 0x3c) {
    return ''
  }
  const end = tagNameEnd(block, 1)
  return end === 1 ? '' : block.slice(1, end).toLowerCase()
}

/** 画像だけの段落（`p:has(> img:only-child)`）か。2段組では段を抜く。 */
function isImageParagraph(block: string): boolean {
  if (tagNameOf(block) !== 'p') {
    return false
  }
  const openEnd = block.indexOf('>')
  if (openEnd === -1) {
    return false
  }
  const inner = block.slice(openEnd + 1)
  if (!inner.startsWith('<img')) {
    return false
  }
  const imgEnd = inner.indexOf('>')
  return imgEnd !== -1 && inner.slice(imgEnd + 1) === '</p>'
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

/** HTML 断片をトップレベルのブロックに分ける。頁分けと差分の印付けが使う。 */
export function splitBlocks(html: string): string[] {
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
  // タグ名は html の中の範囲として持ちます。切り出して toLowerCase すると、
  // ブロックごとに短い文字列を 2 つ捨てることになり、GC がそのぶん回ります。
  let nameStart = start + 1
  if (html.charCodeAt(nameStart) === 0x2f) {
    nameStart += 1
  }
  const nameEnd = tagNameEnd(html, nameStart)
  if (
    nameEnd === nameStart ||
    isName(html, nameStart, nameEnd, 'hr') ||
    isName(html, nameStart, nameEnd, 'br') ||
    isName(html, nameStart, nameEnd, 'img') ||
    html.charCodeAt(gt - 1) === 0x2f
  ) {
    return gt + 1
  }
  const nameLength = nameEnd - nameStart

  // 同じ名前の開きタグと閉じタグを、`<` を 1 つずつ辿って数えます。
  //
  // もとは `indexOf('<name')` と `indexOf('</name>')` を交互に呼んでいました。
  // 閉じタグがすぐ先にあっても、開きタグの探索は次の同名タグまで（無ければ
  // 原稿の末尾まで）走ります。原稿にひとつしかない見出しなどでは、その 1 ブロック
  // ごとに全体を走ることになり、ブロック数に対して二乗時間でした。CPU profile
  // では、この関数だけで組版全体の 1/4 を使っていました。
  //
  // 走査を要素の内側に閉じ込めると、全体の走査量は HTML の長さに比例します。
  let depth = 1
  let i = gt + 1
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      return html.length
    }

    if (html.charCodeAt(lt + 1) === 0x2f) {
      // `</name>` だけを閉じとみなします（`</names>` は別の要素）。
      if (
        sameTag(html, lt + 2, nameStart, nameLength) &&
        html.charCodeAt(lt + 2 + nameLength) === 0x3e
      ) {
        depth -= 1
        if (depth === 0) {
          return lt + 2 + nameLength + 1
        }
      }
    } else if (sameTag(html, lt + 1, nameStart, nameLength)) {
      depth += 1
    }
    i = lt + 1
  }
  return html.length
}

// from から始まるタグ名の終端。タグ名でなければ from をそのまま返します。
function tagNameEnd(html: string, from: number): number {
  const first = html.charCodeAt(from) | 0x20
  if (first < 0x61 || first > 0x7a) {
    return from
  }

  let i = from + 1
  while (i < html.length) {
    const c = html.charCodeAt(i)
    const lower = c | 0x20
    if ((lower < 0x61 || lower > 0x7a) && (c < 0x30 || c > 0x39)) {
      break
    }
    i += 1
  }
  return i
}

// html の [start, end) が name かどうか。大小は区別しません。
function isName(html: string, start: number, end: number, name: string): boolean {
  if (end - start !== name.length) {
    return false
  }
  for (let i = 0; i < name.length; i += 1) {
    if ((html.charCodeAt(start + i) | 0x20) !== name.charCodeAt(i)) {
      return false
    }
  }
  return true
}

// at から始まるタグ名が、nameStart から nameLength 文字の名前と同じかどうか。
function sameTag(html: string, at: number, nameStart: number, nameLength: number): boolean {
  for (let i = 0; i < nameLength; i += 1) {
    if ((html.charCodeAt(at + i) | 0x20) !== (html.charCodeAt(nameStart + i) | 0x20)) {
      return false
    }
  }
  const after = html.charCodeAt(at + nameLength)
  return after === 0x3e || after === 0x20 || after === 0x2f
}

/**
 * v0.2.0-preview 以降に入った機能へのファジング。
 *
 * テストに入れているファジング（`test/fuzz*.test.ts`）は CI が毎回回すので、
 * 件数を数千に抑えています。ここはその外側で、桁を上げて回すためのものです。
 * 既定は 100 万件で、種を渡せば同じ列が再現します。
 *
 *   bun run fuzz
 *   bun run fuzz -- --cases 50000 --only image,svg
 *   bun run fuzz -- --seed 12345
 *
 * 見るのは「落ちない・値が壊れない」だけではありません。寸法の分かっている
 * 画像（正しく組んだ PNG / GIF / JPEG / WebP / AVIF / SVG の見出し）を読ませて
 * 読み取った値そのものを確かめ、頁は 1 枚ずつ組み直して版面に収まっているかを
 * 見て、差分は素朴な DP と keep の数を突き合わせます。
 *
 * 揺さぶる相手（v0.2.0-preview 以降）:
 *
 *   image     画像ファイルの実寸読み取り（`image-size.ts`）
 *   svg       同上の SVG 経路。文字列なので別に厚く回す
 *   measure   断片への寸法の書き入れ（`measure-images.ts`。実ファイルを読む）
 *   typeset   頁分け（ブロック種別ごとの高さ、2段の折り返し、泣き別れの送り）
 *   segment   区画分け（`segments.ts`）と、区画単位の変換の一致
 *   diff      区画差分（`block-diff.ts`）
 *   document  ノンブル・柱つきの組み上げ（`render-page.ts`）
 *   export    静的 HTML の書き出しと画像の複製（`write-files.ts`。実ファイル）
 *   http      差分ビューを含むプレビューの経路（実際の git リポジトリで）
 */
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { createPreviewApp } from '../src/app.js'
import { diffSegments, renderBlockDiff } from '../src/diff/block-diff.js'
import { writeExport } from '../src/export/write-files.js'
import { contained, resolveManuscriptFile } from '../src/manuscript-path.js'
import { unescapeHtml } from '../src/markdown/escape.js'
import {
  normalizeMarkdown,
  renderMarkdown,
  renderMarkdownPiece,
  resetRenderCache,
} from '../src/markdown/render.js'
import { splitSegments } from '../src/markdown/segments.js'
import { imageSize } from '../src/typesetting/image-size.js'
import { withImageSizes } from '../src/typesetting/measure-images.js'
import {
  MAGAZINE_LAYOUT,
  PRINT_LAYOUT,
  paginate,
  splitBlocks,
  type PageLayout,
} from '../src/typesetting/paginate.js'
import { renderDocument, type PreviewMode } from '../src/typesetting/render-page.js'

// ===== 乱数 =====

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rand = () => number

function pick<T>(rand: Rand, items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)]
  /* 空の一覧は渡しません。 */
  if (item === undefined) throw new Error('pick from an empty list')
  return item
}

function upto(rand: Rand, limit: number): number {
  return Math.floor(rand() * limit)
}

// ===== 失敗の記録 =====

class Failures {
  readonly found: { kind: string; seed: number; detail: string }[] = []

  check(condition: boolean, kind: string, seed: number, detail: () => string): void {
    if (condition) return
    if (this.found.length < 40) {
      this.found.push({ kind, seed, detail: detail() })
    }
  }

  guard(kind: string, seed: number, run: () => void): void {
    try {
      run()
    } catch (error) {
      this.check(false, `${kind}/throw`, seed, () => String(error).slice(0, 400))
    }
  }
}

// 1 件あたりに許す時間。二乗時間や暴走する正規表現はここに引っかかります。
const SLOW_MS = 250

// ===== 画像のバイト列 =====

function noise(rand: Rand, length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) bytes[i] = upto(rand, 256)
  return bytes
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const part of parts) total += part.length
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff
  return out
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function jpegBytes(rand: Rand): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])]
  const segments = upto(rand, 6)
  for (let i = 0; i < segments; i += 1) {
    const marker = pick(rand, [0xe0, 0xdb, 0xc0, 0xc2, 0xc4, 0xda, 0xd9, 0xff, 0x01, 0x00])
    const length = upto(rand, 40)
    parts.push(new Uint8Array([0xff, marker, (length >> 8) & 0xff, length & 0xff]))
    parts.push(noise(rand, upto(rand, 20)))
  }
  return concat(parts)
}

function isoBytes(rand: Rand): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0, 0, 0, 0x18]), ascii('ftyp'), ascii('avif')]
  const boxes = upto(rand, 5)
  for (let i = 0; i < boxes; i += 1) {
    if (rand() < 0.6) {
      parts.push(ascii('ispe'))
      parts.push(noise(rand, 12))
    } else {
      parts.push(noise(rand, upto(rand, 24)))
    }
  }
  return concat(parts)
}

function webpBytes(rand: Rand): Uint8Array {
  const chunk = pick(rand, ['VP8 ', 'VP8L', 'VP8X', 'VP8?'])
  return concat([
    ascii('RIFF'),
    noise(rand, 4),
    ascii('WEBP'),
    ascii(chunk),
    noise(rand, upto(rand, 30)),
  ])
}

function imageBytes(rand: Rand): Uint8Array {
  const family = upto(rand, 7)
  let bytes: Uint8Array
  if (family === 0) {
    bytes = concat([PNG_SIGNATURE, noise(rand, 8 + upto(rand, 24))])
  } else if (family === 1) {
    bytes = concat([ascii(pick(rand, ['GIF87a', 'GIF89a', 'GIF8'])), noise(rand, upto(rand, 20))])
  } else if (family === 2) {
    bytes = jpegBytes(rand)
  } else if (family === 3) {
    bytes = webpBytes(rand)
  } else if (family === 4) {
    bytes = isoBytes(rand)
  } else if (family === 5) {
    bytes = ascii(svgText(rand))
  } else {
    bytes = noise(rand, upto(rand, 64))
  }

  // 途中で切れたファイル（読み出しが足りない、壊れている）を混ぜます。
  // 範囲外の読み出しはここで出ます。
  if (rand() < 0.3) bytes = bytes.subarray(0, upto(rand, bytes.length + 1))
  return bytes
}

// ===== 寸法の分かっている画像 =====
//
// 壊れたバイト列で見られるのは「落ちない・おかしな値を返さない」ところまでです。
// 読み取りそのものが合っているかは、正しく組んだ見出しに既知の寸法を入れて、
// 返ってきた値と突き合わせないと分かりません。形式ごとの詰め方（バイト順、
// 14 ビットに詰めた WebP、box を辿らない ispe 拾い）はここで確かめます。

interface KnownImage {
  readonly bytes: Uint8Array
  readonly width: number
  readonly height: number
  readonly note: string
}

function u32be(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

function u16be(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff])
}

function u16le(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff])
}

function u32le(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ])
}

function u24le(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff])
}

/** 1 以上 limit 以下の寸法。境目（1、上限、上限ぎりぎり）を厚めに引きます。 */
function dimension(rand: Rand, limit: number): number {
  const edges = [1, 2, 3, limit, limit - 1, Math.floor(limit / 2)]
  if (rand() < 0.35) {
    const edge = pick(rand, edges)
    return edge >= 1 && edge <= limit ? edge : 1
  }
  return 1 + upto(rand, Math.min(limit, 4096))
}

function knownPng(rand: Rand): KnownImage {
  const width = dimension(rand, 0x7fff_ffff)
  const height = dimension(rand, 0x7fff_ffff)
  return {
    bytes: concat([
      new Uint8Array(PNG_SIGNATURE),
      u32be(13),
      ascii('IHDR'),
      u32be(width),
      u32be(height),
      new Uint8Array([8, 6, 0, 0, 0]),
      u32be(0),
    ]),
    width,
    height,
    note: 'png',
  }
}

function knownGif(rand: Rand): KnownImage {
  const width = dimension(rand, 0xffff)
  const height = dimension(rand, 0xffff)
  return {
    bytes: concat([
      ascii(pick(rand, ['GIF87a', 'GIF89a'])),
      u16le(width),
      u16le(height),
      new Uint8Array([0x00, 0x00, 0x00]),
    ]),
    width,
    height,
    note: 'gif',
  }
}

function knownJpeg(rand: Rand): KnownImage {
  const width = dimension(rand, 0xffff)
  const height = dimension(rand, 0xffff)
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])]
  // 寸法の手前に挟まる領域（Exif、コメント、量子化表）と、詰め物の 0xff。
  const before = upto(rand, 4)
  for (let i = 0; i < before; i += 1) {
    if (rand() < 0.25) parts.push(new Uint8Array([0xff]))
    const payload = noise(rand, upto(rand, 30))
    parts.push(new Uint8Array([0xff, pick(rand, [0xe0, 0xe1, 0xdb, 0xfe, 0xc4])]))
    parts.push(u16be(payload.length + 2))
    parts.push(payload)
  }
  // フレーム開始。長さは自分の 2 バイトを含みます。
  const frame = pick(rand, [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb])
  parts.push(new Uint8Array([0xff, frame]))
  parts.push(u16be(8 + 3))
  parts.push(new Uint8Array([8]))
  parts.push(u16be(height))
  parts.push(u16be(width))
  parts.push(new Uint8Array([1, 1, 0x11, 0]))
  parts.push(new Uint8Array([0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0]))
  return { bytes: concat(parts), width, height, note: `jpeg/${frame.toString(16)}` }
}

function riffHeader(chunk: string, payload: Uint8Array): Uint8Array {
  return concat([
    ascii('RIFF'),
    u32le(payload.length + 12),
    ascii('WEBP'),
    ascii(chunk),
    u32le(payload.length),
    payload,
  ])
}

function knownWebp(rand: Rand): KnownImage {
  const kind = upto(rand, 3)
  if (kind === 0) {
    const width = dimension(rand, 0x3fff)
    const height = dimension(rand, 0x3fff)
    const payload = concat([
      new Uint8Array([0x30, 0x01, 0x00]), // フレームタグ
      new Uint8Array([0x9d, 0x01, 0x2a]), // 同期コード
      u16le(width),
      u16le(height),
      new Uint8Array([0, 0]),
    ])
    return { bytes: riffHeader('VP8 ', payload), width, height, note: 'webp/vp8' }
  }
  if (kind === 1) {
    const width = dimension(rand, 0x4000)
    const height = dimension(rand, 0x4000)
    const bits = (width - 1) | ((height - 1) << 14)
    const payload = concat([
      new Uint8Array([0x2f]),
      u32le(bits >>> 0),
      new Uint8Array([0, 0, 0, 0]),
    ])
    return { bytes: riffHeader('VP8L', payload), width, height, note: 'webp/vp8l' }
  }
  const width = dimension(rand, 0xff_ffff)
  const height = dimension(rand, 0xff_ffff)
  const payload = concat([
    new Uint8Array([0x10, 0, 0, 0]), // フラグと予約
    u24le(width - 1),
    u24le(height - 1),
    new Uint8Array([0, 0, 0, 0]),
  ])
  return { bytes: riffHeader('VP8X', payload), width, height, note: 'webp/vp8x' }
}

function ispeBox(width: number, height: number): Uint8Array {
  return concat([u32be(20), ascii('ispe'), u32be(0), u32be(width), u32be(height)])
}

function knownIso(rand: Rand): KnownImage {
  const width = dimension(rand, 0xffff)
  const height = dimension(rand, 0xffff)
  const parts: Uint8Array[] = [
    u32be(16),
    ascii('ftyp'),
    ascii(pick(rand, ['avif', 'heic', 'mif1'])),
    ascii('avif'),
  ]
  // 縮小版の ispe が先に来ることがあります。いちばん大きいものを採るはず。
  const thumbnail = rand() < 0.5
  if (thumbnail) parts.push(ispeBox(Math.max(1, width >> 4), Math.max(1, height >> 4)))
  parts.push(ispeBox(width, height))
  parts.push(new Uint8Array([0, 0, 0, 0]))
  return { bytes: concat(parts), width, height, note: `iso${thumbnail ? '/thumb' : ''}` }
}

const KNOWN_SVG_UNITS: [string, number][] = [
  ['', 1],
  ['px', 1],
  ['pt', 96 / 72],
  ['pc', 16],
  ['in', 96],
  ['mm', 96 / 25.4],
  ['cm', 96 / 2.54],
  ['q', 96 / 101.6],
]

/** 属性から寸法が定まる SVG。読み取った値まで確かめられる形だけを作ります。 */
function knownSvg(rand: Rand): KnownImage {
  const numbers = ['1', '10', '12.5', '.5', '+3', '0120', '640']
  const [unit, scale] = pick(rand, KNOWN_SVG_UNITS)
  const [unit2, scale2] = pick(rand, KNOWN_SVG_UNITS)
  const w = pick(rand, numbers)
  const h = pick(rand, numbers)
  const cased = (text: string): string => (rand() < 0.2 ? text.toUpperCase() : text)
  const quote = rand() < 0.3 ? "'" : '"'
  const shape = upto(rand, 3)

  if (shape === 0) {
    // width と height がそろっているとき、viewBox は見ない。
    const box = rand() < 0.5 ? ` viewBox="0 0 7 3"` : ''
    return {
      bytes: ascii(
        `<svg width=${quote}${w}${cased(unit)}${quote} height=${quote}${h}${cased(unit2)}${quote}${box}></svg>`,
      ),
      width: Number(w) * scale,
      height: Number(h) * scale2,
      note: `svg/wh ${w}${unit} ${h}${unit2}`,
    }
  }
  const boxWidth = 1 + upto(rand, 400)
  const boxHeight = 1 + upto(rand, 400)
  const separator = pick(rand, [' ', ',', ', ', '  '])
  const box = ` viewBox=${quote}0${separator}0${separator}${boxWidth}${separator}${boxHeight}${quote}`
  if (shape === 1) {
    // viewBox だけ。大きさはそのまま。
    return {
      bytes: ascii(`<svg${box}></svg>`),
      width: boxWidth,
      height: boxHeight,
      note: 'svg/box',
    }
  }
  // 片側だけ。もう片方は viewBox の縦横比で決まる。
  const value = Number(w) * scale
  if (rand() < 0.5) {
    return {
      bytes: ascii(`<svg width=${quote}${w}${cased(unit)}${quote}${box}></svg>`),
      width: value,
      height: (value * boxHeight) / boxWidth,
      note: `svg/w+box ${w}${unit}`,
    }
  }
  return {
    bytes: ascii(`<svg height=${quote}${w}${cased(unit)}${quote}${box}></svg>`),
    width: (value * boxWidth) / boxHeight,
    height: value,
    note: `svg/h+box ${w}${unit}`,
  }
}

function knownImage(rand: Rand): KnownImage {
  const family = upto(rand, 6)
  if (family === 0) return knownPng(rand)
  if (family === 1) return knownGif(rand)
  if (family === 2) return knownJpeg(rand)
  if (family === 3) return knownWebp(rand)
  if (family === 4) return knownIso(rand)
  return knownSvg(rand)
}

// ===== SVG =====

const SVG_NUMBERS = ['10', '0', '-4', '1.5', '.5', '+3', '1e3', '00012', '1.', '999999999999999']
const SVG_UNITS = ['', 'px', 'pt', 'pc', 'in', 'mm', 'cm', 'q', 'Q', '%', 'em', 'PX', 'zz', ' px']

function svgLengthText(rand: Rand): string {
  if (rand() < 0.002) {
    // measure-images.ts が読む 64KB いっぱいの値。走査が二乗になっていれば、
    // 属性ひとつでプレビューが数秒止まります。
    return '1'.repeat(40_000 + upto(rand, 24_000)) + pick(rand, ['', '!', 'px', 'zz', '.'])
  }
  if (rand() < 0.1) {
    // 桁だけが長い値。
    return '1'.repeat(200 + upto(rand, 3000)) + pick(rand, ['', '!', 'px', 'zz', '.'])
  }
  return pick(rand, SVG_NUMBERS) + pick(rand, SVG_UNITS)
}

function svgText(rand: Rand): string {
  const attributes: string[] = []
  if (rand() < 0.8) attributes.push(` width="${svgLengthText(rand)}"`)
  if (rand() < 0.8) attributes.push(` height="${svgLengthText(rand)}"`)
  if (rand() < 0.6) {
    const box = Array.from({ length: 2 + upto(rand, 4) }, () => pick(rand, SVG_NUMBERS))
    attributes.push(` viewBox="${box.join(pick(rand, [' ', ',', ', ', '  ']))}"`)
  }
  if (rand() < 0.3) attributes.push(` xmlns='http://www.w3.org/2000/svg'`)
  if (rand() < 0.2) attributes.push(' width')
  const lead = pick(rand, ['', '\n', '﻿', '  \t', '<?xml version="1.0"?>\n', '<!-- c -->'])
  const close = pick(rand, ['>', '/>', '', ' '])
  return `${lead}<svg${attributes.join('')}${close}</svg>`
}

// ===== 原稿 =====

const INLINE = [
  '`',
  '**',
  '*',
  '[',
  '](',
  ')',
  ']',
  'a',
  'あ',
  '<',
  '&',
  '"',
  "'",
  ' ',
  '![',
  '![図](fig.png)',
  '![a',
  '](img.png)',
  '!',
  '</p>',
  '<blockquote>',
  '|',
  '\\|',
  'text ',
  '漢字かな交じりの本文をそこそこの長さで',
  '[![i](i.png)](https://example.com)',
  'class=',
]
const PREFIX = ['', '# ', '## ', '### ', '> ', '> > ', '- ', '1. ', '```', '---', '| ', '  ', '\t']
const LINE_ENDING = ['\n', '\n', '\n', '\n\n', '\r\n', '\r']

function manuscript(rand: Rand, maxLines: number): string {
  // 半分は記号を並べた原稿、半分は原稿らしいブロックの列。
  if (rand() < 0.5) return documentSource(rand, Math.max(1, Math.ceil(maxLines / 3)))
  const lines: string[] = []
  const count = 1 + upto(rand, maxLines)
  for (let l = 0; l < count; l += 1) {
    let line = pick(rand, PREFIX)
    const parts = upto(rand, 8)
    for (let p = 0; p < parts; p += 1) line += pick(rand, INLINE)
    if (rand() < 0.25) line += '  '
    lines.push(line)
  }
  let source = ''
  for (let l = 0; l < lines.length; l += 1) {
    source += lines[l] ?? ''
    if (l < lines.length - 1) source += pick(rand, LINE_ENDING)
  }
  return source
}

// 記号を並べた原稿は変換の隅を突きますが、頁分けはそれでは動きません（見出しも
// 表もコードも出てこない）。組み上がりの高さ、2段の折り返し、泣き別れの送りに
// 当てるため、原稿らしい形のブロックも同じ割合で混ぜます。

const BODY_TEXT =
  '組版の見当を確かめるための本文です。句読点や、括弧（かっこ）、英字の ASCII text、' +
  '長めの熟語が混ざります。段落の長さはまちまちで、折り返しの数え方をそのまま試します。'

function bodyText(rand: Rand, limit: number): string {
  const length = 1 + upto(rand, limit)
  let text = ''
  while (text.length < length) text += BODY_TEXT
  return text.slice(0, length)
}

function fenceBlock(rand: Rand): string {
  const lines = Array.from(
    { length: 1 + upto(rand, 12) },
    () => '  '.repeat(upto(rand, 3)) + bodyText(rand, 60),
  )
  const open = pick(rand, ['```', '```ts', '```json', '````'])
  // 2 割は閉じないまま。区画分けと差分はここで切り方が変わります。
  return rand() < 0.2 ? `${open}\n${lines.join('\n')}` : `${open}\n${lines.join('\n')}\n\`\`\``
}

function tableBlock(rand: Rand): string {
  const columns = 1 + upto(rand, 4)
  const cell = (): string => (rand() < 0.2 ? '' : bodyText(rand, 1 + upto(rand, 40)))
  const row = (make: () => string): string =>
    `| ${Array.from({ length: columns }, make).join(' | ')} |`
  const rows = [
    row(cell),
    row(() => pick(rand, ['---', ':--', '--:', ':-:'])),
    // 桁のそろわない行を混ぜます。
    ...Array.from({ length: 1 + upto(rand, 6) }, () =>
      rand() < 0.2 ? `| ${cell()} |` : row(cell),
    ),
  ]
  return rows.join('\n')
}

function listBlock(rand: Rand): string {
  const ordered = rand() < 0.4
  return Array.from({ length: 1 + upto(rand, 8) }, (_, i) => {
    const indent = ' '.repeat(2 * upto(rand, 3))
    const marker = ordered ? `${i + 1}. ` : pick(rand, ['- ', '* ', '+ '])
    return `${indent}${marker}${bodyText(rand, 1 + upto(rand, 80))}`
  }).join('\n')
}

function quoteBlock(rand: Rand): string {
  return Array.from({ length: 1 + upto(rand, 5) }, () => {
    const depth = 1 + upto(rand, 2)
    return `${'> '.repeat(depth)}${rand() < 0.2 ? '' : bodyText(rand, 1 + upto(rand, 90))}`
  }).join('\n')
}

function imageBlock(rand: Rand): string {
  const name = `fig${upto(rand, 4)}.${pick(rand, ['png', 'jpg', 'svg', 'webp'])}`
  const alt = rand() < 0.2 ? '' : bodyText(rand, 1 + upto(rand, 20))
  const link = rand() < 0.2
  const image = `![${alt}](${name})`
  return link ? `[${image}](https://example.com/${name})` : image
}

function documentBlock(rand: Rand): string {
  const kind = upto(rand, 9)
  if (kind === 0) return `${pick(rand, ['# ', '## ', '### ', '#### '])}${bodyText(rand, 30)}`
  if (kind === 1) return fenceBlock(rand)
  if (kind === 2) return tableBlock(rand)
  if (kind === 3) return listBlock(rand)
  if (kind === 4) return quoteBlock(rand)
  if (kind === 5) return imageBlock(rand)
  if (kind === 6) return pick(rand, ['---', '***', '___', '- - -'])
  if (kind === 7) return pick(rand, ['<div>', '<div>\n本文\n</div>', '<!-- 覚え書き -->'])
  return bodyText(rand, 1 + upto(rand, 900))
}

/** 原稿らしいブロックを並べたもの。 */
function documentSource(rand: Rand, maxBlocks: number): string {
  const blocks = Array.from({ length: 1 + upto(rand, maxBlocks) }, () => documentBlock(rand))
  let source = ''
  for (const block of blocks) {
    source += block + pick(rand, ['\n\n', '\n\n', '\n\n', '\n', '\n\n\n', '\r\n\r\n'])
  }
  return source
}

/** 原稿を少し書き換える。差分ビューはこの「前と後」を比べます。 */
function edited(rand: Rand, source: string): string {
  const segments = splitSegments(normalizeMarkdown(source))
  const edits = 1 + upto(rand, 3)
  for (let i = 0; i < edits; i += 1) {
    const at = upto(rand, segments.length + 1)
    const what = upto(rand, 4)
    if (what === 0 && segments.length > 0) {
      segments.splice(Math.min(at, segments.length - 1), 1)
    } else if (what === 1) {
      segments.splice(at, 0, manuscript(rand, 3))
    } else if (what === 2 && segments.length > 0) {
      const index = Math.min(at, segments.length - 1)
      segments[index] = `${segments[index] ?? ''}${pick(rand, INLINE)}`
    } else if (segments.length > 1) {
      const from = upto(rand, segments.length)
      const [moved] = segments.splice(from, 1)
      segments.splice(upto(rand, segments.length + 1), 0, moved ?? '')
    }
  }
  return segments.join('\n\n')
}

// ===== HTML の見方 =====

/** タグを除いた地の文。空白の入れ方は頁分けで変わるので詰めて比べる。 */
function textOnly(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, '')
}

/** タグだけを順に並べたもの。要素が消えたり増えたりしていないか見る。 */
function tagStream(html: string): string {
  return (html.match(/<[^>]*>/g) ?? []).join('')
}

/** 組み上げた HTML から、紙（または Web の記事）の中身だけを取り出す。 */
function articles(html: string): string[] {
  return [...html.matchAll(/<article class="[^"]*">\n([\s\S]*?)\n {4}<\/article>/g)].map(
    (match) => match[1] ?? '',
  )
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'meta', 'link'])

/** タグが順番どおり閉じているか。頁の途中でブロックを切ると崩れる。 */
function unbalanced(html: string): string[] {
  const problems: string[] = []
  const open: string[] = []
  let i = 0

  while (i < html.length) {
    if (html.charAt(i) !== '<') {
      i += 1
      continue
    }
    if (html.startsWith('<!', i)) {
      const end = html.indexOf('>', i)
      i = end === -1 ? html.length : end + 1
      continue
    }
    const end = html.indexOf('>', i)
    const raw = end === -1 ? html.slice(i) : html.slice(i, end + 1)
    const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)>$/.exec(raw)
    if (!match) {
      problems.push(`タグとして読めない: ${JSON.stringify(raw.slice(0, 40))}`)
      i += 1
      continue
    }
    const name = (match[2] ?? '').toLowerCase()
    i += raw.length
    if (VOID_TAGS.has(name)) continue
    if (match[1] === '/') {
      const top = open.pop()
      if (top !== name) problems.push(`入れ子が合わない: </${name}> に対して <${top ?? 'なし'}>`)
      continue
    }
    open.push(name)
  }
  if (open.length > 0) problems.push(`閉じていないタグ: ${open.join(',')}`)
  return problems
}

function tagNameOf(block: string): string {
  const found = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(block)
  return (found?.[1] ?? '').toLowerCase()
}

// ===== それぞれのファジング =====

/** 既知の寸法を持つ見出しを読ませ、返ってきた値をそのまま突き合わせる。 */
function checkKnown(failures: Failures, kind: string, seed: number, known: KnownImage): void {
  const size = imageSize(known.bytes)
  failures.check(
    size !== null && size.width === known.width && size.height === known.height,
    `${kind}/known`,
    seed,
    () => `${known.note}: ${JSON.stringify(size)} / want ${known.width}x${known.height}`,
  )
}

function fuzzImage(failures: Failures, base: number, cases: number): void {
  for (let n = 0; n < cases; n += 1) {
    const seed = base + n
    const rand = mulberry32(seed * 2654435761)
    // 半分は寸法の分かっている見出し、半分は壊れたバイト列。
    if (rand() < 0.5) {
      const known = knownImage(rand)
      failures.guard('image', seed, () => checkKnown(failures, 'image', seed, known))
      continue
    }
    const bytes = imageBytes(rand)
    failures.guard('image', seed, () => {
      const started = performance.now()
      const size = imageSize(bytes)
      const elapsed = performance.now() - started
      failures.check(elapsed < SLOW_MS, 'image/slow', seed, () => `${elapsed.toFixed(0)}ms`)
      if (size === null) return
      failures.check(
        Number.isFinite(size.width) && Number.isFinite(size.height),
        'image/finite',
        seed,
        () => JSON.stringify(size),
      )
      failures.check(size.width > 0 && size.height > 0, 'image/positive', seed, () =>
        JSON.stringify(size),
      )
    })
  }
}

function fuzzSvg(failures: Failures, base: number, cases: number): void {
  const encoder = new TextEncoder()
  for (let n = 0; n < cases; n += 1) {
    const seed = base + n
    const rand = mulberry32(seed * 40503 + 7)
    if (rand() < 0.3) {
      const known = knownSvg(rand)
      failures.guard('svg', seed, () => checkKnown(failures, 'svg', seed, known))
      continue
    }
    const text = svgText(rand)
    failures.guard('svg', seed, () => {
      const started = performance.now()
      const size = imageSize(encoder.encode(text))
      const elapsed = performance.now() - started
      failures.check(
        elapsed < SLOW_MS,
        'svg/slow',
        seed,
        () => `${elapsed.toFixed(0)}ms / ${text.slice(0, 120)}`,
      )
      if (size === null) return
      failures.check(
        Number.isFinite(size.width) &&
          size.width > 0 &&
          Number.isFinite(size.height) &&
          size.height > 0,
        'svg/size',
        seed,
        () => `${JSON.stringify(size)} / ${text.slice(0, 120)}`,
      )
    })
  }
}

const HEADINGS = new Set(['h1', 'h2', 'h3'])

// 実際の 2 つの頁と、ブロックごとに切れるだけの小さな頁。
const LAYOUTS: PageLayout[] = [
  PRINT_LAYOUT,
  MAGAZINE_LAYOUT,
  { ...MAGAZINE_LAYOUT, lines: 2, columns: 1 },
]

/** 断片の `<img>` に、measure-images.ts が入れるのと同じ形で寸法を足す。 */
function withSizes(rand: Rand, fragment: string): string {
  return fragment.replace(/<img\b[^>]*>/g, (tag) => {
    if (rand() < 0.25) return tag
    const width = pick(rand, [1, 16, 320, 1200, 4000, 100000])
    const height = pick(rand, [1, 9, 240, 900, 3000, 100000])
    return `${tag.slice(0, -1)} width="${width}" height="${height}">`
  })
}

function fuzzTypeset(failures: Failures, base: number, cases: number): void {
  for (let n = 0; n < cases; n += 1) {
    const seed = base + n
    const rand = mulberry32(seed * 2246822519 + 11)
    const source = manuscript(rand, 40)
    failures.guard('typeset', seed, () => {
      resetRenderCache()
      const fragment = withSizes(rand, renderMarkdown(source))
      const blocks = splitBlocks(fragment)
      for (const layout of LAYOUTS) {
        const started = performance.now()
        const pages = paginate(fragment, layout)
        const elapsed = performance.now() - started
        failures.check(elapsed < SLOW_MS, 'typeset/slow', seed, () => `${elapsed.toFixed(0)}ms`)

        const joined = pages.join('\n')
        failures.check(pages.length > 0, 'typeset/empty', seed, () => 'no pages')
        failures.check(textOnly(joined) === textOnly(fragment), 'typeset/text', seed, () =>
          JSON.stringify(source.slice(0, 200)),
        )
        failures.check(tagStream(joined) === tagStream(fragment), 'typeset/tags', seed, () =>
          JSON.stringify(source.slice(0, 200)),
        )
        for (const page of pages) {
          failures.check(unbalanced(page).length === 0, 'typeset/unbalanced', seed, () =>
            JSON.stringify(page.slice(0, 200)),
          )
        }

        // 泣き別れの送り（v0.2.0-preview 以降）。最後の紙より前の紙は、
        // 見出しだけを残して終わらない。ブロック 1 つの紙は送り先が無い。
        for (let i = 0; i < pages.length - 1; i += 1) {
          const page = splitBlocks(pages[i] ?? '')
          const last = page.at(-1) ?? ''
          failures.check(
            page.length <= 1 || !HEADINGS.has(tagNameOf(last)),
            'typeset/trailing-heading',
            seed,
            () => `頁 ${i + 1}/${pages.length} が ${tagNameOf(last)} で終わる`,
          )
        }

        failures.check(
          pages.length <= Math.max(1, blocks.length),
          'typeset/pages',
          seed,
          () => `${pages.length} 頁 / ${blocks.length} ブロック`,
        )

        // 組み上がった紙 1 枚を、もう一度その寸法で頁分けすると 1 枚のまま。
        // 2 枚に割れるなら、その紙は入りきらない中身を載せていたことになります
        //（ブロック 1 つで紙を越えるものは、置き場が無いので 1 枚に留まります）。
        for (let i = 0; i < pages.length; i += 1) {
          const page = pages[i] ?? ''
          const again = paginate(page, layout)
          failures.check(
            again.length === 1,
            'typeset/refit',
            seed,
            () => `頁 ${i + 1}/${pages.length} が組み直しで ${again.length} 枚に割れる`,
          )
        }

        // 頁分けは覚え書き（blocksOf の cache）を持つので、同じ断片を続けて
        // 頁分けしても結果は変わらない。
        const twice = paginate(fragment, layout)
        failures.check(
          twice.length === pages.length && twice.every((page, at) => page === pages[at]),
          'typeset/stable',
          seed,
          () => `${pages.length} 頁 → ${twice.length} 頁`,
        )
      }
    })
  }
}

function fuzzSegment(failures: Failures, base: number, cases: number): void {
  for (let n = 0; n < cases; n += 1) {
    const seed = base + n
    const rand = mulberry32(seed * 1103515245 + 13)
    const source = manuscript(rand, 30)
    failures.guard('segment', seed, () => {
      const text = normalizeMarkdown(source)
      const segments = splitSegments(text)
      // 区画は原稿の中の重ならない範囲で、順に並び、字面を落とさない。
      let at = 0
      for (const segment of segments) {
        const found = text.indexOf(segment, at)
        failures.check(found >= at, 'segment/order', seed, () =>
          JSON.stringify(segment.slice(0, 80)),
        )
        if (found < at) break
        at = found + segment.length
        failures.check(
          !segment.includes('\n\n') || segment.includes('```'),
          'segment/blank-line',
          seed,
          () => JSON.stringify(segment.slice(0, 120)),
        )
      }
      failures.check(text.slice(at).trim().length === 0, 'segment/lost', seed, () =>
        JSON.stringify(text.slice(at, at + 120)),
      )

      // 区画ごとに変換してつないだものは、原稿全体の変換と同じ。
      // 差分ビューはこの一致に乗っています。
      resetRenderCache()
      const whole = splitBlocks(renderMarkdown(text))
      const byPiece = splitBlocks(
        segments.map((segment) => renderMarkdownPiece(segment)).join('\n'),
      )
      failures.check(whole.join('\n') === byPiece.join('\n'), 'segment/piecewise', seed, () =>
        JSON.stringify(source.slice(0, 200)),
      )
    })
  }
}

/** 空白だけの区画を落とした区画の列。差分が並べ替える相手。 */
function content(text: string): string[] {
  return splitSegments(text).filter((segment) => !/^\s*$/.test(segment))
}

/** 素朴な DP で測る最長共通部分列の長さ。差分の keep と突き合わせます。 */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  let previous = new Uint32Array(b.length + 1)
  let row = new Uint32Array(b.length + 1)
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        row[j] = (previous[j - 1] ?? 0) + 1
      } else {
        const left = row[j - 1] ?? 0
        const up = previous[j] ?? 0
        row[j] = left >= up ? left : up
      }
    }
    const swap = previous
    previous = row
    row = swap
  }
  return previous[b.length] ?? 0
}

/** 食い違った最初のブロックだけを見せる。 */
function firstDifference(got: readonly string[], want: readonly string[]): string {
  for (let i = 0; i < Math.max(got.length, want.length); i += 1) {
    if (got[i] === want[i]) continue
    return ` #${i} got ${JSON.stringify(got[i] ?? null)}\n #${i} want ${JSON.stringify(want[i] ?? null)}`
  }
  return ' (同じ)'
}

/** 同じ形の区画を 2 万個並べた原稿。 */
function manySegments(word: string): string {
  return Array.from({ length: 20_000 }, (_, i) => `${word}${i}`).join('\n\n')
}

const ADDED = ' class="diff-added"'
const REMOVED = ' class="diff-removed"'

function fuzzDiff(failures: Failures, base: number, cases: number): void {
  for (let n = 0; n < cases; n += 1) {
    const seed = base + n
    const rand = mulberry32(seed * 2654435761 + 17)
    const before = manuscript(rand, 24)
    const after = rand() < 0.15 ? before : edited(rand, before)
    failures.guard('diff', seed, () => {
      const oldText = normalizeMarkdown(before)
      const newText = normalizeMarkdown(after)

      const started = performance.now()
      const html = renderBlockDiff(oldText, newText, renderMarkdownPiece)
      const elapsed = performance.now() - started
      failures.check(elapsed < SLOW_MS, 'diff/slow', seed, () => `${elapsed.toFixed(0)}ms`)

      failures.check(unbalanced(html).length === 0, 'diff/unbalanced', seed, () =>
        JSON.stringify(html.slice(0, 200)),
      )

      const blocks = splitBlocks(html)
      const kept = (marker: string, other: string): string[] =>
        blocks.filter((block) => !block.includes(other)).map((block) => block.replace(marker, ''))

      resetRenderCache()
      const newBlocks = splitBlocks(renderMarkdown(newText))
      resetRenderCache()
      const oldBlocks = splitBlocks(renderMarkdown(oldText))

      failures.check(
        kept(ADDED, REMOVED).join('\n') === newBlocks.join('\n'),
        'diff/new',
        seed,
        () => `${JSON.stringify(after)}\n${firstDifference(kept(ADDED, REMOVED), newBlocks)}`,
      )
      failures.check(
        kept(REMOVED, ADDED).join('\n') === oldBlocks.join('\n'),
        'diff/old',
        seed,
        () => `${JSON.stringify(before)}\n${firstDifference(kept(REMOVED, ADDED), oldBlocks)}`,
      )

      if (before === after) {
        failures.check(!html.includes(ADDED) && !html.includes(REMOVED), 'diff/noop', seed, () =>
          JSON.stringify(html.slice(0, 200)),
        )
      }

      // 区画の多い原稿。区画数の積の表を組んでいれば、ここで場所か時間が尽きます。
      if (n % 5000 === 0) {
        const at = performance.now()
        renderBlockDiff(manySegments('段落'), manySegments('別の段落'), renderMarkdownPiece)
        const took = performance.now() - at
        failures.check(
          took < 3000,
          'diff/scale',
          seed,
          () => `区画 2 万どうしの差分に ${took.toFixed(0)}ms`,
        )
      }

      // 差分は「旧に del を当てて add を入れると新になる」もの。並べ直しでは
      // なく、順に当てられることをここで見ます。
      const opsFor = (kind: string): string[] =>
        diffSegments(splitSegments(oldText), splitSegments(newText))
          .filter((op) => op.kind !== kind)
          .map((op) => op.text)
      failures.check(
        opsFor('del').join('\u0000') === content(newText).join('\u0000'),
        'diff/apply-new',
        seed,
        () => JSON.stringify(after.slice(0, 200)),
      )
      failures.check(
        opsFor('add').join('\u0000') === content(oldText).join('\u0000'),
        'diff/apply-old',
        seed,
        () => JSON.stringify(before.slice(0, 200)),
      )

      // keep の数は最長共通部分列の長さそのもの。前後の一致を外す近道や
      // 「まるごと入れ替え」への倒しで、余計に消して足す差分になっていないか。
      // 表を組める大きさのときだけ、素朴な DP と突き合わせます。
      const oldContent = content(oldText)
      const newContent = content(newText)
      if (oldContent.length <= 60 && newContent.length <= 60) {
        const keeps = diffSegments(splitSegments(oldText), splitSegments(newText)).filter(
          (op) => op.kind === 'keep',
        ).length
        const best = lcsLength(oldContent, newContent)
        failures.check(
          keeps === best,
          'diff/lcs-best',
          seed,
          () => `keep ${keeps} / 最長共通部分列 ${best}`,
        )
      }

      // LCS そのもの。keep は両側に同じ順で現れる。
      const ops = diffSegments(splitSegments(oldText), splitSegments(newText))
      const keeps = ops.filter((op) => op.kind === 'keep').length
      failures.check(
        ops.filter((op) => op.kind !== 'add').length ===
          splitSegments(oldText).filter((segment) => !/^\s*$/.test(segment)).length,
        'diff/lcs-old',
        seed,
        () => `keep+del ${ops.length} / keep ${keeps}`,
      )
      failures.check(
        ops.filter((op) => op.kind !== 'del').length ===
          splitSegments(newText).filter((segment) => !/^\s*$/.test(segment)).length,
        'diff/lcs-new',
        seed,
        () => `keep+add ${ops.length} / keep ${keeps}`,
      )
    })
  }
}

const MODES: PreviewMode[] = ['print', 'magazine', 'web']

function fuzzDocument(failures: Failures, base: number, cases: number): void {
  for (let n = 0; n < cases; n += 1) {
    const seed = base + n
    const rand = mulberry32(seed * 40503 + 19)
    const source = manuscript(rand, 30)
    const diff = rand() < 0.5
    failures.guard('document', seed, () => {
      resetRenderCache()
      let fragment = withSizes(rand, renderMarkdown(source))
      if (diff) {
        fragment = renderBlockDiff(
          normalizeMarkdown(source),
          normalizeMarkdown(edited(rand, source)),
          renderMarkdownPiece,
        )
      }
      for (const mode of MODES) {
        const html = renderDocument(fragment, {
          mode,
          liveReload: 'abc',
          diffLink: true,
          diffActive: diff,
        })
        failures.check(
          unbalanced(html).length === 0,
          'document/unbalanced',
          seed,
          () => `${mode}: ${JSON.stringify(source.slice(0, 160))}`,
        )

        // 紙に載った地の文は、組み上げの前の断片と同じ。組み上げは頁分けを
        // 通すので、ここが崩れれば本文の落ちや重複です。
        failures.check(
          textOnly(articles(html).join('')) === textOnly(fragment),
          'document/text',
          seed,
          () => `${mode}: ${JSON.stringify(source.slice(0, 160))}`,
        )

        // 切替は 3 つのモードと、差分ビューでは差分のトグル。
        const links = [...html.matchAll(/<a class="mode-switch-link[^"]*" href="([^"]*)"/g)]
        failures.check(
          links.length === 4,
          'document/switcher',
          seed,
          () => `${mode}: ${links.map((m) => m[1]).join(' ')}`,
        )
        failures.check(
          html.includes('aria-pressed="true"') === diff,
          'document/diff-toggle',
          seed,
          () => `${mode}: ${diff ? '差分' : '通常'}`,
        )

        if (mode === 'web') continue

        // ノンブルは 1 から順に、抜けなく並ぶ。
        const numbers = [...html.matchAll(/data-page="(\d+)"/g)].map((m) => Number(m[1]))
        failures.check(
          numbers.every((value, index) => value === index + 1),
          'document/page-numbers',
          seed,
          () => numbers.slice(0, 12).join(','),
        )
        // 柱は属性の中身。引用符や山括弧が生では出ない。
        for (const match of html.matchAll(/data-head="([^"]*)"/g)) {
          const head = match[1] ?? ''
          failures.check(
            !head.includes('<') && !head.includes('>'),
            'document/running-head',
            seed,
            () => JSON.stringify(head.slice(0, 120)),
          )
        }
        // 柱は 1 枚目には出さない。
        const first = html.indexOf('data-page="1"')
        const second = html.indexOf('data-page="2"')
        const firstPaper = html.slice(first, second === -1 ? first + 40 : second)
        failures.check(!firstPaper.includes('data-head='), 'document/first-head', seed, () =>
          JSON.stringify(firstPaper.slice(0, 120)),
        )
      }
    })
  }
}

/** 実寸から `<img>` に入るはずの値。measure-images.ts と同じ丸め方。 */
function expectedAttribute(value: number): number | null {
  const rounded = Math.max(1, Math.round(value))
  return Number.isSafeInteger(rounded) ? rounded : null
}

async function fuzzMeasure(failures: Failures, base: number, cases: number): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'kumihan-fuzz-measure-'))
  try {
    for (let n = 0; n < cases; n += 1) {
      const seed = base + n
      const rand = mulberry32(seed * 2246822519 + 23)

      // 半分は寸法の分かっている画像。書き入れられた値まで確かめます。
      if (rand() < 0.5) {
        const known = knownImage(rand)
        const extension = looksSvg(known.bytes) ? 'svg' : pick(rand, ['png', 'jpg', 'webp', 'avif'])
        const name = `known${upto(rand, 4)}.${extension}`
        await writeFile(join(root, name), known.bytes)
        // 原稿の中では実体参照になる名前や、原稿の外を指す参照も混ぜます。
        const src = pick(rand, [name, name, name, `./${name}`, `../${name}`, `な い.${extension}`])
        const fragment = renderMarkdown(`![図](${src})\n\n本文\n`)
        try {
          const sized = await withImageSizes(fragment, root)
          const tag = /<img\b[^>]*>/.exec(sized)?.[0] ?? ''
          const width = /\swidth="([^"]*)"/.exec(tag)?.[1]
          const height = /\sheight="([^"]*)"/.exec(tag)?.[1]
          if (src !== name && src !== `./${name}`) {
            // 原稿の外や、無い名前。寸法は入りません。
            failures.check(
              width === undefined && height === undefined,
              'measure/outside',
              seed,
              () => `${src}: ${tag.slice(0, 160)}`,
            )
            continue
          }
          const wantWidth = expectedAttribute(known.width)
          const wantHeight = expectedAttribute(known.height)
          if (wantWidth === null || wantHeight === null) {
            failures.check(
              width === undefined && height === undefined,
              'measure/unsafe',
              seed,
              () => `${known.note}: ${tag.slice(0, 160)}`,
            )
            continue
          }
          failures.check(
            width === String(wantWidth) && height === String(wantHeight),
            'measure/known',
            seed,
            () => `${known.note}: ${tag.slice(0, 160)} / want ${wantWidth}x${wantHeight}`,
          )
        } catch (error) {
          failures.check(false, 'measure/throw', seed, () => String(error).slice(0, 300))
        }
        continue
      }

      const name = `fig${upto(rand, 4)}.${pick(rand, ['png', 'jpg', 'gif', 'webp', 'svg', 'avif'])}`
      await writeFile(join(root, name), imageBytes(rand))
      const fragment = renderMarkdown(`![図](${name})\n\n本文\n`)
      try {
        const started = performance.now()
        const sized = await withImageSizes(fragment, root)
        const elapsed = performance.now() - started
        failures.check(elapsed < SLOW_MS * 4, 'measure/slow', seed, () => `${elapsed.toFixed(0)}ms`)
        failures.check(textOnly(sized) === textOnly(fragment), 'measure/text', seed, () =>
          JSON.stringify(sized.slice(0, 200)),
        )
        for (const tag of sized.matchAll(/<img\b[^>]*>/g)) {
          const width = /\swidth="([^"]*)"/.exec(tag[0])?.[1]
          const height = /\sheight="([^"]*)"/.exec(tag[0])?.[1]
          if (width === undefined && height === undefined) continue
          failures.check(
            /^\d+$/.test(width ?? '') && /^\d+$/.test(height ?? ''),
            'measure/attribute',
            seed,
            () => tag[0].slice(0, 160),
          )
          failures.check(
            tag[0].endsWith('">') && !tag[0].includes('/ width'),
            'measure/tag',
            seed,
            () => tag[0].slice(0, 160),
          )
        }
        // 頁分けはこの寸法を読むので、そのまま通す。
        paginate(sized, MAGAZINE_LAYOUT)
      } catch (error) {
        failures.check(false, 'measure/throw', seed, () => String(error).slice(0, 300))
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** 拡張子を選ぶための見分け。SVG は文字列なので中身で分かります。 */
function looksSvg(bytes: Uint8Array): boolean {
  return bytes[0] === 0x3c
}

/** 出力先にあるファイルを、出力先からの相対パスで集める。 */
async function outputFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
}

// 書き出しが触ってよいのは出力先の中だけです。原稿の外を指す参照や、名前に
// 実体参照・符号化・空白の入った画像を混ぜて、複製の行き先を確かめます。
const EXPORT_IMAGES = ['fig.png', 'a&b.png', "a'b.svg", 'あ 図.jpg', 'sub/dir/x.webp', '%41.gif']
const EXPORT_REFERENCES = [
  ...EXPORT_IMAGES,
  './fig.png',
  '../outside.png',
  'sub/../fig.png',
  'no-such.png',
  'https://example.com/x.png',
  'data:image/png;base64,AAAA',
  '#',
  '',
]

async function fuzzExport(failures: Failures, base: number, cases: number): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'kumihan-fuzz-export-'))
  const outRoot = await mkdtemp(join(tmpdir(), 'kumihan-fuzz-export-out-'))
  const source = join(root, 'index.md')
  // 読めない画像や原稿の外を指す参照は、書き出しが console.error に控えます。
  // ここでは失敗ではないので、走らせているあいだは黙らせます。
  const reportError = console.error
  console.error = () => {}
  try {
    await mkdir(join(root, 'sub', 'dir'), { recursive: true })
    await writeFile(join(root, '..', 'outside.png'), new Uint8Array(PNG_SIGNATURE))

    for (let n = 0; n < cases; n += 1) {
      const seed = base + n
      const rand = mulberry32(seed * 2654435761 + 31)

      // 画像は毎回置き直します。無い名前も混ぜたいので、置くのは一部だけ。
      for (const name of EXPORT_IMAGES) {
        if (rand() < 0.3) continue
        await writeFile(join(root, name), rand() < 0.5 ? knownImage(rand).bytes : imageBytes(rand))
      }

      const references = Array.from({ length: 1 + upto(rand, 4) }, () =>
        pick(rand, EXPORT_REFERENCES),
      )
      const markdown = `${manuscript(rand, 10)}\n\n${references
        .map((reference) => `![図](${reference})`)
        .join('\n\n')}\n`
      await writeFile(source, markdown)

      const out = join(outRoot, `case${n % 8}`)
      await rm(out, { recursive: true, force: true })
      try {
        const written = await writeExport(source, out)

        // 書き出す一式は必ずそろいます。
        for (const name of [
          'index.html',
          'magazine.html',
          'web.html',
          join('assets', 'typeset.css'),
          join('assets', 'web.css'),
        ]) {
          failures.check(
            written.includes(join(out, name)),
            'export/files',
            seed,
            () => `${name} が書き出しに無い`,
          )
        }

        // 触った先はすべて出力先の中。原稿の外を指す参照は複製しません。
        for (const path of written) {
          failures.check(contained(out, path), 'export/outside', seed, () => path)
        }
        const files = await outputFiles(out)
        failures.check(!files.includes('outside.png'), 'export/escape', seed, () => files.join(','))

        // 断片の `<img>` のうち、原稿の下の画像を指すものは書き出しにも入ります。
        // 名前は HTML の実体参照と URL 符号化をくぐるので、戻し方がずれると
        // 「プレビューには映るのに書き出しに無い」になります。
        resetRenderCache()
        for (const tag of renderMarkdown(markdown).matchAll(/<img src="([^"]*)"/g)) {
          const src = unescapeHtml(tag[1] ?? '')
          if ((await resolveManuscriptFile(root, src)) === null) continue
          // 書き出し先は `./fig.png` も `sub/../fig.png` も同じ場所です。
          const name = relative(out, resolve(out, decodeURIComponent(src)))
          failures.check(
            files.includes(name),
            'export/image',
            seed,
            () => `${name} が書き出しに無い / ${files.join(',')}`,
          )
        }

        const pages = ['index.html', 'magazine.html', 'web.html'].map((name) =>
          readFileSync(join(out, name), 'utf8'),
        )
        for (const [at, page] of pages.entries()) {
          failures.check(unbalanced(page).length === 0, 'export/unbalanced', seed, () =>
            unbalanced(page).slice(0, 3).join(','),
          )
          // 書き出しに自動リロードは入りません（CSP も script-src 'none'）。
          failures.check(
            !page.includes('<script'),
            'export/script',
            seed,
            () => `${at}: ${page.slice(0, 160)}`,
          )
        }
        // 3 つの見た目は同じ断片から組みます。地の文は同じ。
        failures.check(
          new Set(pages.map((page) => textOnly(articles(page).join('')))).size === 1,
          'export/text',
          seed,
          () => JSON.stringify(markdown.slice(0, 160)),
        )

        // もう一度書き出しても、同じ一式になります。
        const again = await writeExport(source, out)
        failures.check(
          again.join('\n') === written.join('\n'),
          'export/repeat',
          seed,
          () => `${written.length} → ${again.length}`,
        )
      } catch (error) {
        failures.check(false, 'export/throw', seed, () => String(error).slice(0, 300))
      }
    }
  } finally {
    console.error = reportError
    await rm(join(root, '..', 'outside.png'), { force: true })
    await rm(root, { recursive: true, force: true })
    await rm(outRoot, { recursive: true, force: true })
  }
}

async function fuzzHttp(failures: Failures, base: number, cases: number): Promise<void> {
  const { execFile } = process.getBuiltinModule('node:child_process')
  const run = (cwd: string, args: string[]): Promise<void> =>
    new Promise((settle, fail) => {
      execFile('git', args, { cwd }, (error) => (error ? fail(error) : settle()))
    })

  const root = await mkdtemp(join(tmpdir(), 'kumihan-fuzz-http-'))
  const source = join(root, 'index.md')
  try {
    await run(root, ['init', '-q'])
    await run(root, ['config', 'user.email', 'fuzz@example.com'])
    await run(root, ['config', 'user.name', 'fuzz'])
    await writeFile(source, '# 見出し\n\n本文\n')
    await run(root, ['add', 'index.md'])
    await run(root, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'init'])

    const app = createPreviewApp({ source })
    const paths = [
      '/',
      '/magazine',
      '/magazine.html',
      '/web',
      '/web.html',
      '/diff',
      '/diff.html',
      '/magazine-diff',
      '/web-diff',
      '/health',
      '/assets/typeset.css',
      '/assets/web.css',
      '/assets/reload.js',
    ]
    // 配ってはいけない参照。原稿の外、絶対パス、符号化した `..`、空の名前。
    const refused = [
      '/../index.md',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/..%2ffig.png',
      '/index.md',
      '/fig.png',
      '/assets/../index.md',
      '/%00.png',
    ]
    for (let n = 0; n < cases; n += 1) {
      const seed = base + n
      const rand = mulberry32(seed * 1103515245 + 29)
      const text = manuscript(rand, 20)
      await writeFile(source, text)
      for (const path of paths) {
        const query = rand() < 0.2 ? `?${pick(rand, ['v=1', 'a=%2e%2e', '=', '#'])}` : ''
        const method = rand() < 0.1 ? 'HEAD' : 'GET'
        const response = await app.request(`http://127.0.0.1${path}${query}`, { method })
        const body = await response.text()
        failures.check(
          response.status === 200,
          'http/status',
          seed,
          () => `${path}: ${response.status}`,
        )
        failures.check(
          !body.includes('at Object.') && !body.includes('node:internal'),
          'http/stack',
          seed,
          () => `${path}: ${body.slice(0, 200)}`,
        )
        // 中身を見るのは HTML の頁だけ。HEAD は本文を持ちません。
        if (method === 'HEAD' || path.startsWith('/assets') || path === '/health') continue
        failures.check(
          unbalanced(body).length === 0,
          'http/unbalanced',
          seed,
          () => `${path}: ${unbalanced(body).join(',')}`,
        )
        // プレビューの HTML は毎回 CSP を添えます。
        failures.check(
          body.includes('Content-Security-Policy'),
          'http/csp',
          seed,
          () => `${path}: ${body.slice(0, 160)}`,
        )
        // 差分ビューは、原稿が最初のコミットと違えば必ず印がつきます
        //（区画がすべて空白のときだけ、差分に出す中身がありません）。
        if (path.includes('diff') && normalizeMarkdown(text).trim().length > 0) {
          failures.check(
            body.includes('diff-added') || body.includes('diff-removed'),
            'http/diff-marks',
            seed,
            () => `${path}: ${JSON.stringify(text.slice(0, 160))}`,
          )
        }
      }
      // 原稿の外を指す参照は配りません。
      for (const path of refused) {
        const response = await app.request(`http://127.0.0.1${path}`)
        failures.check(
          response.status === 404,
          'http/refused',
          seed,
          () => `${path}: ${response.status}`,
        )
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// ===== 走らせる =====

interface Category {
  readonly name: string
  /** 100 万件を配るときの取り分。 */
  readonly share: number
  readonly run: (failures: Failures, base: number, cases: number) => void | Promise<void>
}

const CATEGORIES: Category[] = [
  { name: 'image', share: 0.34, run: fuzzImage },
  { name: 'svg', share: 0.16, run: fuzzSvg },
  { name: 'typeset', share: 0.16, run: fuzzTypeset },
  { name: 'segment', share: 0.13, run: fuzzSegment },
  { name: 'diff', share: 0.13, run: fuzzDiff },
  { name: 'document', share: 0.07, run: fuzzDocument },
  { name: 'measure', share: 0.005, run: fuzzMeasure },
  { name: 'export', share: 0.005, run: fuzzExport },
  { name: 'http', share: 0.005, run: fuzzHttp },
]

const { values } = parseArgs({
  options: {
    cases: { type: 'string', default: '1000000' },
    seed: { type: 'string', default: '1' },
    only: { type: 'string' },
  },
  allowPositionals: false,
})

const total = Number(values.cases)
if (!Number.isFinite(total) || total <= 0) {
  console.error('--cases must be a positive number')
  process.exit(2)
}
const seedBase = Number(values.seed)
const wanted = values.only?.split(',').map((name) => name.trim())
const chosen = wanted === undefined ? CATEGORIES : CATEGORIES.filter((c) => wanted.includes(c.name))
if (chosen.length === 0) {
  console.error(`--only must name one of: ${CATEGORIES.map((c) => c.name).join(', ')}`)
  process.exit(2)
}

const weight = chosen.reduce((sum, category) => sum + category.share, 0)
const failures = new Failures()
let ran = 0
const startedAll = performance.now()

for (const category of chosen) {
  const cases = Math.max(1, Math.round((total * category.share) / weight))
  const started = performance.now()
  await category.run(failures, seedBase, cases)
  ran += cases
  const elapsed = (performance.now() - started) / 1000
  console.log(
    `${category.name.padEnd(9)} ${String(cases).padStart(8)} 件  ${elapsed.toFixed(1)}s  ` +
      `(${Math.round(cases / Math.max(elapsed, 0.001))} 件/s)`,
  )
}

console.log(`\n合計 ${ran} 件 / ${((performance.now() - startedAll) / 1000).toFixed(1)}s`)

if (failures.found.length === 0) {
  console.log('見つかった不具合はありません。')
} else {
  const kinds = new Map<string, number>()
  for (const failure of failures.found) kinds.set(failure.kind, (kinds.get(failure.kind) ?? 0) + 1)
  console.log(`\n見つかった不具合 ${failures.found.length} 件（最大 40 件まで記録）:`)
  for (const [kind, count] of kinds) console.log(`  ${kind}: ${count}`)
  console.log('')
  for (const failure of failures.found.slice(0, 20)) {
    console.log(`- [${failure.kind}] seed ${failure.seed}\n  ${failure.detail}`)
  }
  process.exit(1)
}

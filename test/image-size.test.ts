import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vite-plus/test'

import { imageSize } from '../src/typesetting/image-size.js'
import { withImageSizes } from '../src/typesetting/measure-images.js'

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const all = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    all.set(part, at)
    at += part.length
  }
  return all
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function be32(value: number): Uint8Array {
  return bytes((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
}

function le16(value: number): Uint8Array {
  return bytes(value & 0xff, (value >>> 8) & 0xff)
}

const PNG_SIGNATURE = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

function png(width: number, height: number): Uint8Array {
  return concat(PNG_SIGNATURE, be32(13), ascii('IHDR'), be32(width), be32(height))
}

function gif(width: number, height: number): Uint8Array {
  return concat(ascii('GIF89a'), le16(width), le16(height), bytes(0, 0, 0))
}

/** セグメントの列。`segments` は [マーカー, 中身] の並び。 */
function jpeg(...segments: [number, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [bytes(0xff, 0xd8)]
  for (const [marker, body] of segments) {
    parts.push(
      bytes(0xff, marker),
      bytes(((body.length + 2) >>> 8) & 0xff, (body.length + 2) & 0xff),
      body,
    )
  }
  return concat(...parts)
}

/** SOF0 の中身。精度・高さ・幅・成分数。 */
function frame(width: number, height: number): Uint8Array {
  return concat(
    bytes(8),
    bytes((height >>> 8) & 0xff, height & 0xff),
    bytes((width >>> 8) & 0xff, width & 0xff),
    bytes(3),
  )
}

function riff(fourcc: string, body: Uint8Array): Uint8Array {
  return concat(ascii('RIFF'), be32(0), ascii('WEBP'), ascii(fourcc), be32(0), body)
}

describe('image size', () => {
  it('reads PNG', () => {
    assert.deepEqual(imageSize(png(1200, 800)), { width: 1200, height: 800 })
  })

  it('reads GIF', () => {
    assert.deepEqual(imageSize(gif(320, 240)), { width: 320, height: 240 })
  })

  it('reads JPEG past the metadata segments', () => {
    const exif = concat(ascii('Exif'), new Uint8Array(2048))
    const image = jpeg([0xe1, exif], [0xdb, new Uint8Array(64)], [0xc0, frame(640, 480)])
    assert.deepEqual(imageSize(image), { width: 640, height: 480 })
  })

  it('reads a progressive JPEG', () => {
    assert.deepEqual(imageSize(jpeg([0xc2, frame(64, 48)])), { width: 64, height: 48 })
  })

  it('skips JPEG markers without a payload', () => {
    const image = concat(
      bytes(0xff, 0xd8, 0xff, 0xd0, 0xff, 0xff),
      jpeg([0xc0, frame(8, 4)]).slice(2),
    )
    assert.deepEqual(imageSize(image), { width: 8, height: 4 })
  })

  it('gives up on a JPEG whose frame never comes', () => {
    // DHT（寸法を持たない 0xc4）のあと、走査が始まってしまう画像。
    assert.equal(imageSize(jpeg([0xc4, new Uint8Array(4)], [0xda, new Uint8Array(8)])), null)
    assert.equal(imageSize(jpeg([0xe0, new Uint8Array(4)])), null)
    // 長さの壊れたセグメント、マーカーで始まらないバイト列。
    assert.equal(
      imageSize(concat(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00), new Uint8Array(16))),
      null,
    )
    assert.equal(imageSize(concat(bytes(0xff, 0xd8), new Uint8Array(16))), null)
  })

  it('reads the three WebP chunks', () => {
    const lossy = riff('VP8 ', concat(bytes(0, 0, 0, 0x9d, 0x01, 0x2a), le16(300), le16(200)))
    assert.deepEqual(imageSize(lossy), { width: 300, height: 200 })

    // VP8L は 14 ビットずつ詰めた「幅 − 1」「高さ − 1」。
    const packed = (200 - 1) | ((100 - 1) << 14)
    const lossless = riff(
      'VP8L',
      bytes(
        0x2f,
        packed & 0xff,
        (packed >>> 8) & 0xff,
        (packed >>> 16) & 0xff,
        (packed >>> 24) & 0xff,
      ),
    )
    assert.deepEqual(imageSize(lossless), { width: 200, height: 100 })

    const extended = riff(
      'VP8X',
      concat(bytes(0, 0, 0, 0), bytes(99, 0, 0), bytes(49, 0, 0), bytes(0, 0)),
    )
    assert.deepEqual(imageSize(extended), { width: 100, height: 50 })
  })

  it('rejects WebP without readable dimensions', () => {
    assert.equal(imageSize(riff('VP8 ', new Uint8Array(12))), null)
    assert.equal(imageSize(riff('VP8L', new Uint8Array(6))), null)
    assert.equal(imageSize(riff('ANIM', new Uint8Array(16))), null)
    assert.equal(imageSize(concat(ascii('RIFF'), be32(0), ascii('WEBP'))), null)
  })

  it('reads the largest ispe of an AVIF', () => {
    const avif = concat(
      be32(24),
      ascii('ftyp'),
      ascii('avif'),
      new Uint8Array(12),
      be32(20),
      ascii('ispe'),
      be32(0),
      be32(320),
      be32(240),
      be32(20),
      ascii('ispe'),
      be32(0),
      be32(1600),
      be32(1200),
    )
    assert.deepEqual(imageSize(avif), { width: 1600, height: 1200 })
    assert.equal(imageSize(concat(be32(16), ascii('ftyp'), ascii('avif'), new Uint8Array(4))), null)
  })

  it('reads the SVG root element', () => {
    assert.deepEqual(imageSize(ascii('<svg width="120" height="60"></svg>')), {
      width: 120,
      height: 60,
    })
    // 単位つき（1pt = 96/72px、1mm = 96/25.4px）。
    assert.deepEqual(imageSize(ascii("<svg width='72pt' height='36pt'>")), {
      width: 96,
      height: 48,
    })
    // 宣言と BOM の先にある `<svg`。
    assert.deepEqual(
      imageSize(
        concat(bytes(0xef, 0xbb, 0xbf), ascii('<?xml version="1.0"?>\n<svg viewBox="0 0 40 20">')),
      ),
      { width: 40, height: 20 },
    )
    // 宣言の前の空白や改行も越えます。
    assert.deepEqual(imageSize(ascii('\n  <svg width="10" height="5">')), { width: 10, height: 5 })
    // 片方だけの寸法は viewBox の縦横比で補う。
    assert.deepEqual(imageSize(ascii('<svg width="80" viewBox="0 0 40 20">')), {
      width: 80,
      height: 40,
    })
    assert.deepEqual(imageSize(ascii('<svg height="40" viewBox="0,0,40,20">')), {
      width: 80,
      height: 40,
    })
  })

  it('rejects SVG whose size depends on where it is placed', () => {
    assert.equal(imageSize(ascii('<svg width="100%" height="100%">')), null)
    assert.equal(imageSize(ascii('<svg width="10em" height="4em">')), null)
    assert.equal(imageSize(ascii('<svg width="0" height="0" viewBox="0 0 0 0">')), null)
    assert.equal(imageSize(ascii('<svg viewBox="0 0 10">')), null)
    assert.equal(imageSize(ascii('<svg viewBox="a b c d">')), null)
    assert.equal(imageSize(ascii('<svg>')), null)
    assert.equal(imageSize(ascii('<html><body>')), null)
    assert.equal(imageSize(ascii('   ')), null)
  })

  // ここから 2 つはファジングで見つけた不具合の回帰テストです。
  it('reads a width made only of digits in one pass', () => {
    // measure-images.ts は画像の先頭 64KB を読みます。長さの走査が桁数の
    // 二乗になっていたので、桁を並べた width ひとつでプレビューが 10 秒
    // 近く止まりました（原稿の隣に置いた SVG 1 つで起こせます）。
    const svg = `<svg width="${'1'.repeat(64 * 1024)}!" height="10"></svg>`
    const started = performance.now()
    assert.equal(imageSize(ascii(svg)), null)
    const elapsed = performance.now() - started
    assert.ok(elapsed < 1000, `64KB の width の走査に ${elapsed.toFixed(0)}ms かかった`)
  })

  it('rejects a size that overflows while keeping the viewBox ratio', () => {
    // 縦だけが桁外れなら、viewBox の比から出した幅があふれます。Infinity を
    // 通すと `<img width="Infinity">` が組み上がりました。
    const tall = `<svg height="${'1'.repeat(308)}" viewBox="0 0 100 1"></svg>`
    assert.equal(imageSize(ascii(tall)), null)
  })

  it('rejects bytes that are neither an image nor markup', () => {
    assert.equal(imageSize(new Uint8Array(0)), null)
    assert.equal(imageSize(bytes(0x00, 0x01, 0x02, 0x03)), null)
    assert.equal(imageSize(PNG_SIGNATURE), null)
    assert.equal(imageSize(png(0, 0)), null)
    assert.equal(imageSize(ascii('GIF8')), null)
  })
})

/** 空のディレクトリを原稿の場所として渡し、あとで片づけます。 */
async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'kumihan-measure-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('measuring the images of a manuscript', () => {
  it('writes the size of every image it can read', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'a.png'), png(1200, 800))
      await writeFile(join(root, 'b&c.gif'), gif(20, 10))
      const fragment = '<p><img src="a.png" alt="図"></p>\n<p><img src="b&amp;c.gif" alt=""></p>'
      assert.equal(
        await withImageSizes(fragment, root),
        '<p><img src="a.png" alt="図" width="1200" height="800"></p>\n' +
          '<p><img src="b&amp;c.gif" alt="" width="20" height="10"></p>',
      )
    })
  })

  it('reads each image once, however often the manuscript shows it', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'a.png'), png(10, 20))
      const fragment = '<p><img src="a.png" alt="1"><img src="a.png" alt="2"></p>'
      assert.equal(
        await withImageSizes(fragment, root),
        '<p><img src="a.png" alt="1" width="10" height="20">' +
          '<img src="a.png" alt="2" width="10" height="20"></p>',
      )
    })
  })

  it('leaves alone what it cannot or should not read', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'broken.png'), PNG_SIGNATURE)
      const fragment = [
        '<p><img src="https://example.com/a.png" alt=""></p>',
        '<p><img src="../outside.png" alt=""></p>',
        '<p><img src="missing.png" alt=""></p>',
        '<p><img src="broken.png" alt=""></p>',
        '<p><img src="a.png" alt="" width="10" height="10"></p>',
        '<p><img alt="src がない"></p>',
        '<p><img src="" alt=""></p>',
      ].join('\n')
      assert.equal(await withImageSizes(fragment, root), fragment)
    })
  })

  it('returns a manuscript without images untouched', async () => {
    await withRoot(async (root) => {
      assert.equal(await withImageSizes('<p>図はありません。</p>', root), '<p>図はありません。</p>')
      assert.equal(
        await withImageSizes('<p><img src="#anchor" alt=""></p>', root),
        '<p><img src="#anchor" alt=""></p>',
      )
    })
  })

  it('leaves an image whose size does not fit an integer attribute untouched', async () => {
    // SVG は `width="1..1"`（100 桁）のような長さも持てます。丸めた値が
    // 指数表記になると `width="1e+100"` という属性を書き込んでいました。
    await withRoot(async (root) => {
      const huge = `<svg width="${'1'.repeat(100)}" height="${'1'.repeat(100)}"></svg>`
      await writeFile(join(root, 'huge.svg'), ascii(huge))
      assert.equal(
        await withImageSizes('<p><img src="huge.svg" alt=""></p>', root),
        '<p><img src="huge.svg" alt=""></p>',
      )
    })
  })

  it('rounds a fractional size up to at least one pixel', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'a.svg'), ascii('<svg width="10.4" height="0.2"></svg>'))
      assert.equal(
        await withImageSizes('<p><img src="a.svg" alt=""></p>', root),
        '<p><img src="a.svg" alt="" width="10" height="1"></p>',
      )
    })
  })
})

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

import { describe, it } from 'vite-plus/test'

import { createPreviewApp } from '../src/app.js'
import { writeExport } from '../src/export/write-files.js'
import { renderMarkdown } from '../src/markdown/render.js'

// v0.1.0 のあとに入った `![alt](path)`（#27）を、原稿からプレビューと書き出しの
// 両方へ通して揺さぶります。画像は同じ 1 つの原稿から 2 つの経路へ出ていくので、
// 「プレビューに映る画像は、書き出しにも同じ場所に置かれる」が成り立たなければ
// いけません。ファイル名は機械的に作るので、記号や日本語の混ざった名前も通ります。
// 種は固定なので再現します。

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

const NAME_CHARS = [
  'a',
  'z',
  '0',
  '9',
  '-',
  '_',
  '&',
  "'",
  '"',
  '%',
  '+',
  '=',
  '@',
  ',',
  ';',
  '[',
  ']',
  '!',
  '~',
  'あ',
  '図',
  'é',
  '.',
  '$',
  '<',
  '>',
]
const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.PNG']

function randomName(rand: () => number): string {
  let name = ''
  const length = 1 + Math.floor(rand() * 8)
  for (let i = 0; i < length; i += 1) {
    name += NAME_CHARS[Math.floor(rand() * NAME_CHARS.length)] ?? ''
  }
  return name + (EXTENSIONS[Math.floor(rand() * EXTENSIONS.length)] ?? '.png')
}

// 1×1 の PNG。中身は問わないので最小のものを使います。
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

// ブラウザが src 属性を読むときと同じ実体参照の戻し。
function unescapeHtml(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
}

function imageSrc(markdown: string): string | undefined {
  return /<img src="([^"]*)"/.exec(renderMarkdown(markdown))?.[1]
}

// ブラウザが要求するパスを、サーバと同じやり方でファイル名へ戻します。
// 符号化として壊れているもの（名前に生の `%` があるときなど）は undefined。
function decodePath(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname.slice(1))
  } catch {
    return undefined
  }
}

async function outputFiles(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true })).map((file) => file.split(sep).join('/'))
}

describe('image fuzzing', () => {
  it('serves and exports every image the preview shows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kumihan-image-fuzz-'))
    const source = join(root, 'index.md')
    const app = createPreviewApp({ source })
    const rand = mulberry32(987654321)

    try {
      await mkdir(join(root, 'sub'), { recursive: true })
      for (let seed = 1; seed <= 120; seed += 1) {
        const nested = rand() < 0.25
        const relative = (nested ? 'sub/' : '') + randomName(rand)
        try {
          await writeFile(join(root, relative), PNG)
        } catch {
          continue // ファイル名として作れないものは対象外。
        }

        // 著者が書くであろう 2 通りの参照の仕方（そのままと、URL 符号化）。
        for (const reference of [relative, relative.split('/').map(encodeURIComponent).join('/')]) {
          const markdown = `# 見出し\n\n![alt](${reference})\n`
          const src = imageSrc(markdown)
          // 記法として画像にならない参照（空白や括弧を含む名前）は対象外。
          if (src === undefined || src === '#') continue

          await writeFile(source, markdown)
          // ブラウザは実体参照を戻してから要求します。
          const url = new URL(unescapeHtml(src), 'http://127.0.0.1/')
          // `?` や `#` を含む名前は URL の区切りに化けてプレビューのルートへ
          // 落ちます。画像配信の判定ではないので対象外。
          if (url.pathname === '/') continue

          // 名前の `%` は URL では符号化の始まりです。そのまま書いた参照は
          // ブラウザから別のパスとして要求されるので、実在する画像を指す
          // ときだけ確かめます。
          const wanted = decodePath(url.pathname)
          if (wanted !== relative) continue

          const response = await app.request(url.toString())
          assert.equal(response.status, 200, `${relative} を配信できない`)
          assert.match(response.headers.get('Content-Type') ?? '', /^image\//)

          const out = await mkdtemp(join(tmpdir(), 'kumihan-image-out-'))
          try {
            await writeExport(source, out)
            assert.ok(
              (await outputFiles(out)).includes(wanted),
              `プレビューに映る ${relative} が書き出しに無い（src=${src}）`,
            )
          } finally {
            await rm(out, { recursive: true, force: true })
          }
        }
        await rm(join(root, relative), { force: true })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('exports an image whose name contains characters HTML escapes', async () => {
    // `a&b.png` は src 属性で `a&amp;b.png` になります。実体参照を戻さずに
    // ファイルを探すと、プレビューには映るのに書き出しにだけ画像が無い、
    // という食い違いになります。
    const root = await mkdtemp(join(tmpdir(), 'kumihan-entity-'))
    const out = await mkdtemp(join(tmpdir(), 'kumihan-entity-out-'))
    const source = join(root, 'index.md')

    try {
      const names = ['a&b.png', "a'b.png", 'a"b.png', 'a<b>.png']
      for (const name of names) await writeFile(join(root, name), PNG)
      await writeFile(source, `${names.map((name) => `![alt](${name})`).join('\n\n')}\n`)

      const written = await writeExport(source, out)
      const files = await outputFiles(out)
      for (const name of names) {
        assert.ok(files.includes(name), `${name} が書き出されていない`)
      }
      assert.equal(written.filter((path) => path.endsWith('.png')).length, names.length)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(out, { recursive: true, force: true })
    }
  })

  it('keeps exporting when one image cannot be copied', async () => {
    // 画像として通る名前でも複製が失敗することはあります（`figures.png` という
    // 名前のディレクトリなど）。そこで投げると HTML ごと書き出しが止まります。
    const root = await mkdtemp(join(tmpdir(), 'kumihan-copyfail-'))
    const out = await mkdtemp(join(tmpdir(), 'kumihan-copyfail-out-'))
    const source = join(root, 'index.md')
    const logged: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => logged.push(args)

    try {
      await mkdir(join(root, 'figures.png'), { recursive: true })
      await writeFile(join(root, 'ok.png'), PNG)
      await writeFile(source, '![a](figures.png)\n\n![b](ok.png)\n')

      const written = await writeExport(source, out)
      const files = await outputFiles(out)
      assert.ok(files.includes('index.html'))
      assert.ok(files.includes('ok.png'))
      assert.equal(
        written.some((path) => path.endsWith(`${sep}figures.png`)),
        false,
      )
      assert.equal(logged.length, 1)
      assert.match(String(logged[0]?.[0]), /画像を書き出せません/)
    } finally {
      console.error = original
      await rm(root, { recursive: true, force: true })
      await rm(out, { recursive: true, force: true })
    }
  })
})

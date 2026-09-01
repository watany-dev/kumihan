import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { contained, resolveManuscriptFile } from '../manuscript-path.js'
import { toManuscript, type ManuscriptSource } from '../manuscript.js'
import { unescapeHtml } from '../markdown/escape.js'
import { renderMarkdown } from '../markdown/render.js'
import { withImageSizes } from '../typesetting/measure-images.js'
import { exportFiles } from './export-site.js'

export async function writeExport(source: ManuscriptSource, outDir: string): Promise<string[]> {
  const manuscript = toManuscript(source)
  const markdown = await manuscript.read()

  // 断片は HTML の組み立てと画像の収集の両方で使うので、変換は 1 回だけに
  // します。以前は HTML の組み立てと画像の走査が別々に renderMarkdown を
  // 呼んでいて、書き出しで最も重い段階が原稿全体に対して丸ごと 2 回走って
  // いました。
  // 画像の実寸を書き入れてから組みます。頁分けが図の高さを見積もれるように
  // なり、書き出した HTML はブラウザが読み込む前に図の場所を空けられます。
  const fragment = await withImageSizes(renderMarkdown(markdown), manuscript.root)
  const destRoot = resolve(outDir)

  // 書き出しも画像の複製も互いに独立しているので、直列に待たずまとめて実行する。
  const [written, copied] = await Promise.all([
    Promise.all(
      exportFiles(fragment).map(async (file) => {
        const dest = join(outDir, file.pathname.replace(/^\//, ''))
        await mkdir(dirname(dest), { recursive: true })
        // 本文は元から文字列なので、Response を経由して UTF-8 へ起こし直さず
        // そのまま渡します（writeFile の既定が UTF-8 なのでバイト列は同じ）。
        await writeFile(dest, file.body)
        return dest
      }),
    ),
    copyImages(fragment, manuscript.root, destRoot),
  ])
  return [...written, ...copied]
}

async function copyImages(fragment: string, root: string, destRoot: string): Promise<string[]> {
  const copies: Promise<string | null>[] = []
  // 同じ画像を並行して同じ出力先へ複製しないための記録。`a.png` と `./a.png`
  // のように書き方が違っても出力先は同じなので、出力先の絶対パスで見ます。
  const seen = new Set<string>()
  for (const match of fragment.matchAll(/<img src="([^"]*)"/g)) {
    // src は HTML として書き出した後の文字列です。名前に `&` や `'` を含む
    // 画像は `a&amp;b.png` のようになっているので、ファイルを探す前に戻します。
    // ブラウザは実体参照を戻してから要求するので、戻さないとプレビューには
    // 出るのに書き出しにだけ画像が無い、という食い違いになります。
    const src = unescapeHtml(match[1] ?? '')
    if (src.length === 0 || src.startsWith('#') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) continue

    let destRel = src
    try {
      destRel = decodeURIComponent(src)
    } catch {
      console.error(`[kumihan] 画像の出力先が不正です: ${src}`)
      continue
    }
    const dest = resolve(destRoot, destRel)
    if (!contained(destRoot, dest)) {
      console.error(`[kumihan] 画像の出力先が不正です: ${src}`)
      continue
    }
    if (seen.has(dest)) continue
    seen.add(dest)
    copies.push(copyImage(src, dest, root))
  }
  // 順番どおりに集めてから失敗ぶんを除くので、成功した画像の並びは原稿の
  // 登場順のまま変わりません。
  return (await Promise.all(copies)).filter((dest) => dest !== null)
}

async function copyImage(src: string, dest: string, root: string): Promise<string | null> {
  const from = await resolveManuscriptFile(root, src)
  if (from === null) {
    console.error(`[kumihan] 画像が見つかりません: ${src}`)
    return null
  }
  // 画像として通った参照でも、複製そのものは失敗しえます（`figures.png` と
  // いう名前のディレクトリ、読めない権限、途中で消えたファイル）。ここで
  // 投げると HTML まで含めて書き出し全体が止まるので、その画像だけ諦めます。
  try {
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(from, dest)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`[kumihan] 画像を書き出せません: ${src} (${detail})`)
    return null
  }
  return dest
}

import { Buffer } from 'node:buffer'

/**
 * 標準入力を最後まで読み切って UTF-8 の文字列にします。
 *
 * チャンクごとに文字列へ起こすと、マルチバイト文字が境界で割れたときに
 * 壊れます。バイト列のまま溜めてから一度だけデコードします。
 */
export async function readStdin(
  stream: AsyncIterable<Uint8Array> = process.stdin,
): Promise<string> {
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

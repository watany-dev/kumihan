import assert from 'node:assert/strict'

import { describe, it } from 'vite-plus/test'

import { renderMarkdown, resetRenderCache } from '../src/markdown/render.js'

// renderMarkdown は前回の原稿との差分だけを変換し直す。このテストは
// 「どんな編集をしても、素の変換（キャッシュ無し）と同じ HTML になる」
// ことを確かめる。増分変換の切り貼りにずれがあれば、ここで食い違う。

function fresh(source: string): string {
  resetRenderCache()
  return renderMarkdown(source)
}

function assertIncrementalMatches(before: string, after: string): void {
  const expected = fresh(after)
  resetRenderCache()
  renderMarkdown(before)
  const actual = renderMarkdown(after)
  assert.equal(actual, expected)
}

const MANUSCRIPT = [
  '# 見出し',
  '',
  '最初の段落です。**強調**も入っています。',
  '',
  '- 一つ',
  '- 二つ',
  '',
  '> 引用の段落',
  '> 二行目',
  '',
  '```',
  'コードの中',
  '',
  '空行をまたぐコード',
  '```',
  '',
  '| 左 | 右 |',
  '| --- | --- |',
  '| a | b |',
  '',
  '最後の段落。',
].join('\n')

describe('renderMarkdown incremental cache', () => {
  it('renders the same manuscript to the same html', () => {
    const expected = fresh(MANUSCRIPT)
    // 中身が同じ別の文字列オブジェクトでも、同じ結果を返す。
    const copy = ` ${MANUSCRIPT}`.slice(1)
    assert.equal(renderMarkdown(copy), expected)
  })

  it('rerenders after editing a middle paragraph', () => {
    assertIncrementalMatches(MANUSCRIPT, MANUSCRIPT.replace('一つ', '一つ目'))
  })

  it('rerenders after editing the first block', () => {
    assertIncrementalMatches(MANUSCRIPT, MANUSCRIPT.replace('# 見出し', '## 別の見出し'))
  })

  it('rerenders after editing the last block', () => {
    assertIncrementalMatches(MANUSCRIPT, MANUSCRIPT.replace('最後の段落。', '最後の段落に追記。'))
  })

  it('rerenders after prepending a block', () => {
    assertIncrementalMatches(MANUSCRIPT, `前置きの段落。\n\n${MANUSCRIPT}`)
  })

  it('rerenders after appending a block', () => {
    assertIncrementalMatches(MANUSCRIPT, `${MANUSCRIPT}\n\n追記の段落。`)
  })

  it('rerenders after appending text without a separator', () => {
    // 最後の区画が伸びるだけで、区切りは増えない。
    assertIncrementalMatches(MANUSCRIPT, `${MANUSCRIPT}続き。`)
  })

  it('rerenders after deleting a block', () => {
    assertIncrementalMatches(MANUSCRIPT, MANUSCRIPT.replace('> 引用の段落\n> 二行目\n\n', ''))
  })

  it('rerenders after inserting a block in the middle', () => {
    assertIncrementalMatches(
      MANUSCRIPT,
      MANUSCRIPT.replace('> 引用の段落', '差し込みの段落。\n\n> 引用の段落'),
    )
  })

  it('rerenders after merging two blocks by removing a blank line', () => {
    assertIncrementalMatches(
      MANUSCRIPT,
      MANUSCRIPT.replace('- 二つ\n\n> 引用の段落', '- 二つ\n> 引用の段落'),
    )
  })

  it('rerenders after splitting a block with a new blank line', () => {
    assertIncrementalMatches(MANUSCRIPT, MANUSCRIPT.replace('- 一つ\n- 二つ', '- 一つ\n\n- 二つ'))
  })

  it('rerenders after changing the run of blank lines', () => {
    assertIncrementalMatches(MANUSCRIPT, MANUSCRIPT.replace('\n\n> 引用', '\n\n\n\n> 引用'))
  })

  it('keeps a fence spanning blank lines as one block', () => {
    // フェンスの中の空行は区切りではない。編集後も 1 つのコードブロックのまま。
    assertIncrementalMatches(MANUSCRIPT, MANUSCRIPT.replace('コードの中', 'コードを書き換えた'))
  })

  it('rerenders when the closing fence is removed', () => {
    // 閉じフェンスが消えると、残りの原稿はすべてコードブロックに吸い込まれる。
    assertIncrementalMatches(
      MANUSCRIPT,
      MANUSCRIPT.replace('空行をまたぐコード\n```', '空行をまたぐコード'),
    )
  })

  it('rerenders when a closing fence is added', () => {
    const unclosed = MANUSCRIPT.replace('空行をまたぐコード\n```', '空行をまたぐコード')
    assertIncrementalMatches(unclosed, MANUSCRIPT)
  })

  it('rerenders when an opening fence is inserted near the start', () => {
    assertIncrementalMatches(MANUSCRIPT, MANUSCRIPT.replace('# 見出し', '```\n# 見出し'))
  })

  it('handles a manuscript that starts with a fence', () => {
    const fenced = '```\nfirst\n\nsecond\n```\n\n段落。'
    assertIncrementalMatches(fenced, fenced.replace('段落。', '別の段落。'))
    assertIncrementalMatches(fenced, fenced.replace('first', 'FIRST'))
  })

  it('handles whitespace-only lines between blocks', () => {
    // 空白だけの行は区切りにはならないが、renderLines が読み飛ばすので
    // どちらの経路でも結果は同じになる。
    const spaced = '段落一。\n\n \n\n段落二。'
    assertIncrementalMatches(spaced, spaced.replace('段落二。', '段落二に追記。'))
    assertIncrementalMatches(spaced, `${spaced}\n\n段落三。`)
  })

  it('handles a manuscript that becomes empty', () => {
    assertIncrementalMatches(MANUSCRIPT, '')
    assertIncrementalMatches('', MANUSCRIPT)
  })

  it('handles whitespace-only manuscripts', () => {
    assertIncrementalMatches(' \n\n \n\n段落。', ' \n\n \n\n別の段落。')
    assertIncrementalMatches('段落。\n\n \n\n ', ' \n\n ')
  })

  it('splices a tail after the leading blocks became whitespace', () => {
    // 使い回す末尾の手前が空白だけの区画になり、変換結果が空のまま
    // 末尾をつなぐ。末尾の先頭に残っていた区切りはここで外れる。
    assertIncrementalMatches('x\n\n段落。\n\n次。', ' \n\n段落。\n\n次。')
  })

  it('splices a tail that had no separator before it', () => {
    // 前回は先頭（空白だけの区画の後）だった区画を、今回は本文の後ろに
    // つなぐ。区切りはここで足される。
    assertIncrementalMatches(' \n\n段落。', '新しい段落。\n\n \n\n段落。')
  })

  it('splices a tail made only of whitespace blocks', () => {
    assertIncrementalMatches('段落。\n\n \n\n \n\nx', '別の段落。\n\n \n\n \n\nx')
    assertIncrementalMatches('段落。\n\n \n\n ', '別の段落。\n\n \n\n ')
  })

  it('normalizes CRLF only in the changed range', () => {
    const before = '段落一。\r\n\r\n段落二。\r\n\r\n段落三。'
    assertIncrementalMatches(before, before.replace('段落二。', '段落二を編集。'))
    // 前回が CRLF 入り（正規化された）原稿でも、編集後の変換は素の変換と一致する。
    assertIncrementalMatches(before, '段落一。\n\n段落二。\n\n段落三。')
  })

  it('normalizes a CR inserted by the edit', () => {
    const before = '段落一。\n\n段落二。'
    assertIncrementalMatches(before, '段落一。\r\n改行を挟む。\n\n段落二。')
  })

  it('strips the hard break sentinel inserted by the edit', () => {
    const before = '段落一。\n\n段落二。'
    assertIncrementalMatches(before, '段落一。\u0001\n\n段落二。')
  })

  it('rerenders when the previous manuscript needed normalizing', () => {
    // 前回の原稿が正規化を要した（clean でない）ときは、生の差分の早道を
    // 通らずに、正規化してから差分を取る。
    const before = '段落一。\r\n\r\n段落二。\u0001'
    assertIncrementalMatches(before, '段落一。\r\n\r\n段落二を編集。')
  })

  it('rerenders table edits', () => {
    assertIncrementalMatches(MANUSCRIPT, MANUSCRIPT.replace('| a | b |', '| a | b |\n| c | d |'))
    assertIncrementalMatches(MANUSCRIPT, MANUSCRIPT.replace('| --- | --- |\n', ''))
  })

  it('rerenders repeated identical blocks correctly', () => {
    const repeated = Array.from({ length: 12 }, () => '同じ段落。').join('\n\n')
    assertIncrementalMatches(repeated, repeated.replace('同じ段落。', '違う段落。'))
    assertIncrementalMatches(repeated, `同じ段落。\n\n${repeated}`)
  })
})

// 記法を混ぜた原稿を機械的に作り、無作為な編集のたびに素の変換と比べる。
// 種は固定なので再現する。

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

const PIECES = [
  '# 見出し\n',
  '本文の段落。\n',
  '**強調**と`code`。\n',
  '- 箇条書き\n',
  '1. 番号\n',
  '> 引用\n',
  '```\n',
  'コード\n',
  '---\n',
  '| a | b |\n',
  '| --- | --- |\n',
  ' \n',
  '\n',
  '行末スペース  \n',
  '\r\n',
  '\n',
]

function generate(rand: () => number): string {
  const parts = 2 + Math.floor(rand() * 24)
  let source = ''
  for (let i = 0; i < parts; i += 1) {
    source += PIECES[Math.floor(rand() * PIECES.length)] ?? ''
  }
  return source
}

function mutate(source: string, rand: () => number): string {
  const kind = rand()
  const at = Math.floor(rand() * (source.length + 1))
  const piece = PIECES[Math.floor(rand() * PIECES.length)] ?? ''
  if (kind < 0.4) {
    // 挿入
    return source.slice(0, at) + piece + source.slice(at)
  }
  if (kind < 0.7) {
    // 削除
    const size = Math.floor(rand() * 12)
    return source.slice(0, at) + source.slice(at + size)
  }
  // 置き換え
  const size = Math.floor(rand() * 12)
  return source.slice(0, at) + piece + source.slice(at + size)
}

describe('renderMarkdown incremental fuzzing', () => {
  it('matches a fresh render after random edits', () => {
    const rand = mulberry32(0x6b756d69)
    for (let round = 0; round < 250; round += 1) {
      const before = generate(rand)
      let current = before
      resetRenderCache()
      renderMarkdown(current)
      // 同じ原稿へ編集を重ね、毎回のキャッシュ越しの変換を素の変換と比べる。
      for (let edit = 0; edit < 3; edit += 1) {
        current = mutate(current, rand)
        const actual = renderMarkdown(current)
        const expected = fresh(current)
        assert.equal(actual, expected, `round ${round} edit ${edit}: ${JSON.stringify(current)}`)
        // 次の編集は温まったキャッシュから続ける。
        renderMarkdown(current)
      }
    }
  })
})

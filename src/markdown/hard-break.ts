// 段落の強制改行（行末の 2 スペース）を表す内部の目印です。
// 行を 1 本の文字列に畳んでからインライン記法を解釈するため、
// 「ここは改行だった」という情報を本文中の 1 文字として持ち回ります。
//
// 目印は本文と同じ文字列に混ざるので、扱いには 2 つの約束があります。
//   1. 原稿に同じ文字が紛れていたら、目印として使う前に取り除く
//      （escapeHtml をすり抜けて生の <br> になってしまうため）。
//   2. 目印を HTML へ起こすのは renderInline の地の文だけ。
//      コードスパンの中身は文字どおりに出すので <br> にしてはいけない。
export const HARD_BREAK = '\u0001'

export function stripHardBreakSentinel(text: string): string {
  if (!text.includes(HARD_BREAK)) {
    return text
  }
  return text.replaceAll(HARD_BREAK, '')
}

export const typesetCss = `@page {
  size: A4;
  margin: 0;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

html,
body {
  margin: 0;
  padding: 0;
}

body {
  background: #cfc9be;
  min-height: 100vh;
}

.paper {
  position: relative;
  width: 210mm;
  min-height: 297mm;
  margin: 12mm auto;
  padding: 22mm 20mm 24mm;
  background: #ffffff;
  color: #1a1a1a;
  box-shadow: 0 1.2mm 6mm rgba(40, 30, 20, 0.22);

  /*
   * 画面の外に出ている頁は組まない。
   *
   * プレビューは Refresh で頁を丸ごと作り直します。ブラウザは毎回すべての頁を
   * 組み直すので、原稿が伸びるとリロード 1 回が秒単位になります（331KB の原稿で
   * parse+layout に 2.3 秒。2 秒間隔のリロードが追い越されていました）。
   *
   * 頁は A4 と分かっているので、見えていない頁は実寸を伝えて中身の組版だけ
   * 飛ばせます。スクロールバーの長さは変わらず、見えた時点で組まれます。
   * contain-intrinsic-size の auto は、一度組んだ頁の実寸を覚えるという意味で、
   * 行数の見積りがずれて 297mm を超えた頁もそのまま扱えます。
   */
  content-visibility: auto;
  contain-intrinsic-size: auto 210mm auto 297mm;
}

/*
 * 柱（上）とノンブル（下）。版面の外、上 22mm / 下 24mm の余白の中に置くので
 * 本文とは重なりません。柱の無い 1 枚目は data-head が無く、::before は
 * そもそも作られません。@media print で消していないので印刷にも残ります。
 */
.paper::before,
.paper::after {
  position: absolute;
  left: 20mm;
  right: 20mm;
  text-align: center;
  font-family:
    "Hiragino Mincho ProN",
    "Yu Mincho",
    "YuMincho",
    "Noto Serif CJK JP",
    serif;
  color: #6b6459;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.paper[data-head]::before {
  content: attr(data-head);
  top: 11mm;
  font-size: 8.5pt;
  letter-spacing: 0.08em;
}

.paper::after {
  content: attr(data-page);
  bottom: 11mm;
  font-size: 9pt;
  letter-spacing: 0.04em;
}

.typeset {
  font-family:
    "Hiragino Mincho ProN",
    "Yu Mincho",
    "YuMincho",
    "Noto Serif CJK JP",
    serif;
  font-size: 10.5pt;
  line-height: 1.9;
  font-kerning: normal;
  line-break: strict;
  word-break: normal;
  overflow-wrap: break-word;
  hanging-punctuation: allow-end;
  text-autospace: normal;
}

.typeset h1,
.typeset h2,
.typeset h3 {
  font-family:
    "Hiragino Kaku Gothic ProN",
    "Yu Gothic",
    "YuGothic",
    sans-serif;
  font-weight: 600;
  line-height: 1.45;
  break-after: avoid;
}

.typeset h1 {
  font-size: 18pt;
  margin: 0 0 1.1em;
  letter-spacing: 0.06em;
}

.typeset h2 {
  font-size: 13.5pt;
  margin: 1.8em 0 0.7em;
  padding-bottom: 0.28em;
  border-bottom: 0.4pt solid #d0cdc6;
}

.typeset h3 {
  font-size: 12pt;
  margin: 1.5em 0 0.5em;
}

.typeset p {
  text-align: justify;
  text-justify: inter-ideograph;
  widows: 2;
  orphans: 2;
  margin: 0 0 0.9em;
}

.typeset p:last-child {
  margin-bottom: 0;
}

.typeset a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 0.18em;
}

.typeset img {
  max-width: 100%;

  /*
   * 実寸は img の width / height 属性で渡します（measure-images.ts）。属性は
   * 幅と高さの指定でもあるので、auto に戻して縦横比だけを使わせます。戻さないと
   * 幅が実寸のまま決まり、max-height で高さだけ切り詰められた図がゆがみます。
   */
  width: auto;
  height: auto;

  /*
   * 図の高さは段 1 本まで。原稿に対して実寸で組む必要はないので、大きな写真は
   * ここまで縮めます（縦横比はそのまま）。段落の下の余白（0.9em）を引いてある
   * ので、地の文に混ざった画像は余白を足しても段 1 本に収まります。図版
   *（figure）はキャプションのぶんさらに低く、下の .typeset figure img です。
   *
   * 頁分け（paginate.ts の imageMaxLines）はこの高さで見積もります。両者が
   * ずれると図のある頁があふれるので、test/paginate.test.ts が一致を見ます。
   */
  max-height: calc(35 * 1.9em - 0.9em);
}

/*
 * 図版。画像 1 枚だけの段落は figure + figcaption に組まれます
 *（src/markdown/render.ts）。キャプションはゴシックで本文より小さく、
 * 図の下に中央で置きます。
 */
.typeset figure {
  margin: 0 0 0.9em;
  text-align: center;
}

/*
 * 図の高さは段 1 本から、下の余白（0.9em）とキャプション 1 行（0.5 + 1.6 を
 * 0.85 の級数で = 1.785em）を引いた高さまで。ここまで縮めておけば、図版は
 * キャプションごと段 1 本にちょうど収まります。頁分け（paginate.ts の
 * figureImageMaxLines）はこの高さで見積もります。
 */
.typeset figure img {
  max-height: calc(35 * 1.9em - 2.685em);
}

.typeset figcaption {
  margin-top: 0.5em;
  font-family:
    "Hiragino Kaku Gothic ProN",
    "Yu Gothic",
    "YuGothic",
    sans-serif;
  font-size: 0.85em;
  line-height: 1.6;
  text-align: center;
  color: #4a453d;
}

/* 図番号（「図 1」）。振るのは render-page.ts で、原稿の順です。 */
.typeset .figure-number {
  font-weight: 600;
}

.typeset blockquote {
  margin: 1.2em 0 1.2em 0.4em;
  padding: 0.15em 0 0.15em 1em;
  border-left: 2px solid #8a8378;
  color: #333333;
}

.typeset ul,
.typeset ol {
  margin: 0 0 0.9em;
  padding-left: 1.5em;
}

.typeset li {
  margin: 0.15em 0;
}

.typeset hr {
  border: none;
  border-top: 0.4pt solid #bbbbbb;
  margin: 2em 0;
}

.typeset code {
  font-family: ui-monospace, "SFMono-Regular", "Menlo", "Consolas", monospace;
  font-size: 0.92em;
  background: #f4f1ea;
  padding: 0.05em 0.35em;
}

.typeset pre {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  break-inside: avoid;
  background: #f4f1ea;
  padding: 1em 1.1em;
  margin: 0 0 1.1em;
  line-height: 1.6;
  font-size: 0.92em;
}

.typeset pre code {
  background: none;
  padding: 0;
  font-size: inherit;
}

.typeset table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 1.1em;
  font-size: 0.95em;
  break-inside: avoid;
}

.typeset th,
.typeset td {
  border: 0.4pt solid #d0cdc6;
  padding: 0.35em 0.65em;
  vertical-align: top;
}

.typeset th {
  font-family:
    "Hiragino Kaku Gothic ProN",
    "Yu Gothic",
    "YuGothic",
    sans-serif;
  font-weight: 600;
  background: #f4f1ea;
  text-align: left;
}

.typeset .align-center {
  text-align: center;
}

.typeset .align-right {
  text-align: right;
}

.typeset.cols-2 {
  column-count: 2;
  column-gap: 8mm;
  column-rule: 0.3pt solid #d0cdc6;
  font-size: 9.5pt;
  line-height: 1.75;
  column-fill: balance;

  /*
   * 段の高さは 40 行。頁分け（paginate.ts）はこの高さの 2 段ぶんに詰めます。
   *
   * height ではなく min-height なのは、詰めすぎた頁を紙の外へ流さないためです。
   * 高さの決まった段組みは、入りきらない中身を段の右外に「あふれ段」として
   * 並べます。紙にはみ出した段はビューポートの端で切れ、表は 1 文字ずつに
   * 潰れて、原稿が壊れたように見えていました。
   *
   * 組み上がりの高さは組んでみるまで分からないので（折り返しは書体で変わり、
   * 画像は実寸を読んでも小数の丸めが残ります）、見積りはいつか外れます。
   * min-height なら、あふれた頁はその頁が縦に伸びるだけで済みます。紙が
   * 1 枚だけ長くなるのは目で見て分かり、中身は読めるまま残ります。
   */
  min-height: calc(40 * 1.75em);
}

/* 2段組は段が低いので、図の上限もそのぶん下がります。 */
.typeset.cols-2 img {
  max-height: calc(40 * 1.75em - 0.9em);
}

.typeset.cols-2 figure img {
  max-height: calc(40 * 1.75em - 2.685em);
}

.typeset.cols-2 h1,
.typeset.cols-2 h1 + p,
.typeset.cols-2 pre,
.typeset.cols-2 hr,
.typeset.cols-2 figure {
  column-span: all;
}

/*
 * 差分の印は高さを変えない。頁分けは class を見ないので、padding や
 * border-left を足すと字詰がずれて紙があふれる。背景と、版面の左余白・
 * 段間へ出した縦罫（::after）だけにする。
 */
.typeset .diff-added,
.typeset .diff-removed {
  position: relative;
}

.typeset .diff-added {
  background: #f1f8f2;
}

.typeset .diff-removed {
  background: #fdf2f3;
}

.typeset .diff-added::after,
.typeset .diff-removed::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -2.4mm;
  width: 1.2mm;
}

.typeset .diff-added::after {
  background: #2e7d32;
}

.typeset .diff-removed::after {
  background: #e60012;
}

.mode-switch {
  position: fixed;
  top: 12px;
  right: 16px;
  z-index: 10;
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  overflow: hidden;
  border: 1px solid #c8c2b6;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(40, 30, 20, 0.12);
  font-family:
    "Hiragino Kaku Gothic ProN",
    "Yu Gothic",
    "YuGothic",
    sans-serif;
  font-size: 12px;
  font-weight: 600;
}

.mode-switch-link {
  display: inline-block;
  padding: 0.45em 0.9em;
  color: #444444;
  text-decoration: none;
}

.mode-switch-link.is-active {
  color: #ffffff;
  background: #1a1a1a;
}

.mode-switch-link[aria-pressed="true"] {
  background: #eef6ee;
}

.mode-switch-link:not(.is-active):hover {
  background: #f4f1ea;
}

.mode-switch-link[aria-pressed="true"]:hover {
  background: #e4f0e4;
}

.mode-switch-link:focus-visible {
  outline: 2px solid #1a1a1a;
  outline-offset: -2px;
}

@media print {
  body {
    background: #ffffff;
  }

  .mode-switch {
    display: none;
  }

  .paper {
    margin: 0;
    box-shadow: none;
    width: 210mm;
    min-height: 297mm;
    break-after: page;

    /* 紙に出すときは全頁を組む（画面外を飛ばす最適化を打ち消す）。 */
    content-visibility: visible;
  }

  .paper:last-of-type {
    break-after: auto;
  }
}
`

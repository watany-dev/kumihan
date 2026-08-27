export const magazineCss = `@page {
  size: B5;
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

body.magazine,
body.feature {
  min-height: 100vh;
  background: #c5cdd0;
}

body.feature {
  background: #cbbfb0;
}

.paper.magazine-sheet,
.paper.feature-sheet {
  width: 182mm;
  min-height: 257mm;
  margin: 12mm auto;
  background: #ffffff;
  color: #1a1a1a;
  box-shadow: 0 1.2mm 6mm rgba(40, 30, 20, 0.22);
}

.paper.magazine-sheet {
  padding: 11mm 13mm 14mm;
}

.paper.feature-sheet {
  padding: 0 13mm 14mm;
}

.masthead,
.folio {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1em;
  font-family:
    "Hiragino Kaku Gothic ProN",
    "Yu Gothic",
    "YuGothic",
    sans-serif;
  font-size: 8pt;
  letter-spacing: 0.12em;
}

.masthead {
  margin: 0 0 6mm;
  padding: 0 0 2.4mm;
  border-bottom: 1.8pt solid #0e6e7c;
}

.masthead p,
.folio p,
.feature-band p {
  margin: 0;
}

.masthead-mark,
.folio-mark {
  font-weight: 700;
  color: #0e6e7c;
}

.masthead-label,
.folio-label {
  color: #555555;
}

.folio {
  margin-top: 7mm;
  padding-top: 2.2mm;
  border-top: 0.45pt solid #0e6e7c;
}

.feature-band {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1em;
  margin: 0 -13mm 7mm;
  padding: 5.5mm 13mm 5mm;
  background: #152033;
  color: #ffffff;
  font-family:
    "Hiragino Kaku Gothic ProN",
    "Yu Gothic",
    "YuGothic",
    sans-serif;
}

.feature-kicker {
  font-size: 9.5pt;
  font-weight: 700;
  letter-spacing: 0.28em;
  color: #ff7a18;
}

.feature-issue {
  font-size: 8pt;
  letter-spacing: 0.16em;
  color: #d7dde8;
}

.feature-folio {
  border-top-color: #152033;
}

.feature-folio .folio-mark {
  color: #152033;
}

.magazine-typeset,
.feature-typeset {
  column-count: 2;
  column-gap: 6.5mm;
  column-rule: 0.25pt solid #c8c3bb;
  column-fill: balance;
  font-family:
    "Hiragino Kaku Gothic ProN",
    "Yu Gothic",
    "YuGothic",
    sans-serif;
  font-size: 9pt;
  line-height: 1.72;
  font-kerning: normal;
  line-break: strict;
  word-break: normal;
  overflow-wrap: break-word;
  hanging-punctuation: allow-end;
  text-autospace: normal;
}

.magazine-typeset h1,
.magazine-typeset h2,
.magazine-typeset h3,
.feature-typeset h1,
.feature-typeset h2,
.feature-typeset h3 {
  font-weight: 700;
  line-height: 1.35;
  break-after: avoid;
  break-inside: avoid;
}

.magazine-typeset h1,
.feature-typeset h1 {
  column-span: all;
  margin: 0 0 0.55em;
  letter-spacing: 0.04em;
}

.magazine-typeset h1 {
  font-size: 16pt;
  padding-bottom: 0.28em;
  border-bottom: 2.2pt solid #0e6e7c;
}

.feature-typeset h1 {
  font-size: 20pt;
  margin-bottom: 0.45em;
  color: #152033;
}

.magazine-typeset h1 + p,
.feature-typeset h1 + p {
  column-span: all;
  margin: 0 0 1.05em;
  padding-bottom: 0.85em;
  border-bottom: 0.45pt solid #d0cdc6;
  color: #333333;
  font-size: 10pt;
  font-weight: 500;
  line-height: 1.8;
}

.magazine-typeset h2,
.feature-typeset h2 {
  font-size: 11pt;
  margin: 1.15em 0 0.45em;
  padding: 0.05em 0 0.05em 0.45em;
}

.magazine-typeset h2 {
  border-left: 3.2pt solid #0e6e7c;
}

.feature-typeset h2 {
  border-left: 3.2pt solid #ff7a18;
}

.magazine-typeset h3,
.feature-typeset h3 {
  font-size: 10pt;
  margin: 1em 0 0.35em;
}

.magazine-typeset h3::before,
.feature-typeset h3::before {
  content: "●";
  display: inline;
  margin-right: 0.35em;
  font-size: 0.72em;
}

.magazine-typeset h3::before {
  color: #0e6e7c;
}

.feature-typeset h3::before {
  color: #ff7a18;
}

.magazine-typeset p,
.feature-typeset p {
  text-align: justify;
  text-justify: inter-ideograph;
  widows: 2;
  orphans: 2;
  margin: 0 0 0.75em;
}

.magazine-typeset p:last-child,
.feature-typeset p:last-child {
  margin-bottom: 0;
}

.magazine-typeset a,
.feature-typeset a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 0.16em;
}

.magazine-typeset blockquote,
.feature-typeset blockquote {
  break-inside: avoid;
  margin: 0.9em 0;
  padding: 0.65em 0.75em 0.7em;
  color: #222222;
}

.magazine-typeset blockquote {
  background: #eef6f7;
  border-top: 1.6pt solid #0e6e7c;
  border-bottom: 1.6pt solid #0e6e7c;
}

.feature-typeset blockquote {
  column-span: all;
  background: #fff6ee;
  border-top: 1.8pt solid #ff7a18;
  border-bottom: 1.8pt solid #ff7a18;
}

.magazine-typeset blockquote::before,
.feature-typeset blockquote::before {
  display: block;
  margin-bottom: 0.3em;
  font-size: 7.5pt;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.magazine-typeset blockquote::before {
  content: "NOTE";
  color: #0e6e7c;
}

.feature-typeset blockquote::before {
  content: "POINT";
  color: #ff7a18;
}

.magazine-typeset blockquote p:last-child,
.feature-typeset blockquote p:last-child {
  margin-bottom: 0;
}

.magazine-typeset ul,
.magazine-typeset ol,
.feature-typeset ul,
.feature-typeset ol {
  margin: 0 0 0.75em;
  padding-left: 1.25em;
}

.magazine-typeset li,
.feature-typeset li {
  margin: 0.12em 0;
}

.magazine-typeset hr,
.feature-typeset hr {
  column-span: all;
  border: none;
  border-top: 0.4pt solid #bbbbbb;
  margin: 1.4em 0;
}

.magazine-typeset code,
.feature-typeset code {
  font-family: ui-monospace, "SFMono-Regular", "Menlo", "Consolas", monospace;
  font-size: 0.9em;
  background: #f3f1ea;
  padding: 0.04em 0.28em;
}

.magazine-typeset pre,
.feature-typeset pre {
  column-span: all;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  break-inside: avoid;
  background: #f3f1ea;
  padding: 0.85em 1em;
  margin: 0.4em 0 1em;
  line-height: 1.55;
  font-size: 8pt;
}

.magazine-typeset pre code,
.feature-typeset pre code {
  background: none;
  padding: 0;
  font-size: inherit;
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

body.magazine .mode-switch-link.is-active {
  background: #0e6e7c;
}

body.feature .mode-switch-link.is-active {
  background: #152033;
}

.mode-switch-link:not(.is-active):hover {
  background: #f4f1ea;
}

.mode-switch-link:focus-visible {
  outline: 2px solid #1a1a1a;
  outline-offset: -2px;
}

@media print {
  body.magazine,
  body.feature {
    background: #ffffff;
  }

  .mode-switch {
    display: none;
  }

  .paper.magazine-sheet,
  .paper.feature-sheet {
    margin: 0;
    box-shadow: none;
    width: 182mm;
    min-height: 257mm;
  }
}
`

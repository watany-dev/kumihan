export const webCss = `*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
}

body.web {
  min-height: 100vh;
  background: #f3f3f3;
  color: #333333;
  font-family:
    "Hiragino Kaku Gothic ProN",
    "Hiragino Sans",
    "Yu Gothic",
    "YuGothic",
    Meiryo,
    sans-serif;
}

.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: #ffffff;
  border-top: 3px solid #e60012;
  border-bottom: 1px solid #e5e5e5;
}

.site-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  max-width: 1120px;
  height: 56px;
  margin: 0 auto;
  padding: 0 24px;
}

.site-brand {
  margin: 0;
  color: #222222;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.site-brand::before {
  content: "";
  display: inline-block;
  width: 0.55em;
  height: 0.55em;
  margin-right: 0.45em;
  background: #e60012;
  vertical-align: 0.08em;
}

.mode-switch {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  overflow: hidden;
  border: 1px solid #dddddd;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
}

.mode-switch-link {
  display: inline-block;
  padding: 0.4em 0.85em;
  color: #444444;
  background: #ffffff;
  text-decoration: none;
}

.mode-switch-link.is-active {
  color: #ffffff;
  background: #e60012;
}

.mode-switch-link:not(.is-active):hover {
  background: #f7f7f7;
}

.mode-switch-link:focus-visible {
  outline: 2px solid #e60012;
  outline-offset: -2px;
}

.article-shell {
  max-width: 760px;
  margin: 1.5rem auto 4rem;
  padding: 0 1rem;
}

.article {
  padding: 2.5rem 2.75rem 3.5rem;
  background: #ffffff;
  border: 1px solid #ebebeb;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  overflow-wrap: break-word;
  word-break: normal;
  line-break: strict;
  font-kerning: normal;
}

.article h1,
.article h2,
.article h3 {
  color: #222222;
  font-weight: 700;
  line-height: 1.4;
}

.article h1 {
  margin: 0 0 0.85em;
  font-size: 1.75rem;
  letter-spacing: 0.01em;
}

.article h1 + p {
  margin: 0 0 1.8em;
  padding-bottom: 1.4em;
  border-bottom: 1px solid #eeeeee;
  color: #555555;
  font-size: 1.02rem;
  font-weight: 500;
  line-height: 1.85;
}

.article h2 {
  margin: 2.2em 0 0.8em;
  padding: 0.15em 0 0.15em 0.7em;
  border-left: 5px solid #e60012;
  font-size: 1.35rem;
}

.article h3 {
  margin: 1.8em 0 0.65em;
  padding-bottom: 0.35em;
  border-bottom: 1px solid #d6d6d6;
  font-size: 1.12rem;
}

.article p {
  margin: 0 0 1.25em;
  font-size: 16px;
  line-height: 1.9;
}

.article p:last-child {
  margin-bottom: 0;
}

.article a {
  color: #0055aa;
  text-decoration: none;
}

.article a:hover {
  text-decoration: underline;
  text-underline-offset: 0.18em;
}

.article blockquote {
  margin: 1.4em 0;
  padding: 0.9em 1.1em;
  border-left: 4px solid #cccccc;
  background: #f8f8f8;
  color: #555555;
}

.article blockquote p:last-child {
  margin-bottom: 0;
}

.article ul,
.article ol {
  margin: 0 0 1.25em;
  padding-left: 1.5em;
}

.article li {
  margin: 0.25em 0;
  line-height: 1.8;
}

.article hr {
  border: none;
  border-top: 1px solid #e5e5e5;
  margin: 2.2em 0;
}

.article code {
  font-family: ui-monospace, "SFMono-Regular", "Menlo", "Consolas", monospace;
  font-size: 0.9em;
  background: #f4f4f4;
  border: 1px solid #ececec;
  border-radius: 3px;
  padding: 0.08em 0.35em;
}

.article pre {
  margin: 0 0 1.4em;
  padding: 1em 1.15em;
  overflow-x: auto;
  background: #f5f5f5;
  border: 1px solid #e4e4e4;
  border-radius: 4px;
  line-height: 1.55;
  font-size: 13px;
}

.article pre code {
  background: none;
  border: none;
  border-radius: 0;
  padding: 0;
  font-size: inherit;
}

.article table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 1.4em;
  font-size: 0.95em;
}

.article th,
.article td {
  border: 1px solid #e0e0e0;
  padding: 0.55em 0.75em;
  vertical-align: top;
  overflow-wrap: anywhere;
}

.article th {
  background: #f7f7f7;
  font-weight: 700;
  text-align: left;
  color: #222222;
}

.article .align-center {
  text-align: center;
}

.article .align-right {
  text-align: right;
}

@media (max-width: 640px) {
  .site-header-inner {
    height: 52px;
    padding: 0 12px;
  }

  .article-shell {
    margin-top: 0.75rem;
    padding: 0;
  }

  .article {
    padding: 1.5rem 1.15rem 2.4rem;
    border-left: none;
    border-right: none;
  }

  .article h1 {
    font-size: 1.45rem;
  }

  .article h2 {
    font-size: 1.2rem;
  }
}

@media print {
  body.web {
    background: #ffffff;
  }

  .site-header {
    position: static;
  }

  .mode-switch {
    display: none;
  }

  .article-shell {
    max-width: none;
    margin: 0;
    padding: 0;
  }

  .article {
    border: none;
    box-shadow: none;
    padding: 0;
  }
}
`

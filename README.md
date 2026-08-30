# kumihan

Markdown 原稿を、A4 の組版・2段組・Web 記事の 3 つの見た目でプレビューし、静的 HTML に書き出すツールです。

個人または小規模な執筆を対象にした v0.1 です。VS Code Extension、CMS、データベースは含みません。編集は手元のエディタで行い、ブラウザは表示だけです。

```
原稿.md
  │
  ├─ 組版     A4 1段組（明朝本文）
  ├─ 2段      A4 縦2列
  └─ Web      画面幅に合わせた記事
         │
         ▼
   HTML + CSS（プレビュー / dist/）
```

## はじめ方

[Releases](https://github.com/watany-dev/kumihan/releases) から実行ファイルを落とします。

```bash
curl -fsSL -o kumihan \
  https://github.com/watany-dev/kumihan/releases/latest/download/kumihan-linux-x64
chmod +x kumihan
./kumihan serve manuscript.md
```

ブラウザで http://127.0.0.1:3000 を開き、右上から表示モードを切り替えます。保存した原稿は、数秒以内にプレビューへ反映されます。

```bash
./kumihan export manuscript.md --out dist
```

| ファイル                                      | 対象    |
| --------------------------------------------- | ------- |
| `kumihan-linux-x64` / `kumihan-linux-arm64`   | Linux   |
| `kumihan-darwin-x64` / `kumihan-darwin-arm64` | macOS   |
| `kumihan-windows-x64.exe`                     | Windows |

macOS で隔離されるときは `xattr -d com.apple.quarantine kumihan-darwin-arm64` を実行してください。既定の待ち受けは `127.0.0.1:3000` です。ポートやホストを変えるときは `--port` / `--host` を付けます。

## このリポジトリで書く

原稿の置き場は `content/index.md` です。履歴は Git に任せます。

### GitHub Codespaces

1. このリポジトリを Codespaces で開く
2. ターミナルで `bun run dev` を実行する
3. Forwarded Port `3000`（Typeset Preview）をブラウザで開く
4. `content/index.md` を編集して保存する

### ローカル

[Vite+](https://viteplus.dev/)（`vp`）と [Bun](https://bun.sh/) 1.4.0 が必要です。

```bash
curl -fsSL https://vite.plus | bash
curl -fsSL https://bun.sh/install | bash
vp install
bun run dev
```

http://127.0.0.1:3000 を開きます。同じ LAN の別端末から見たいときだけ `KUMIHAN_HOST=0.0.0.0 bun run dev` のように明示してください。

## 原稿

対応している記法:

- `#` / `##` / `###` 見出し
- 段落
- `**bold**` / `*emphasis*` / `` `inline code` ``
- `[link](https://example.com)`
- `![alt](path)` 画像（相対パス / `https:` / `http:`）
- `>` 引用
- `-` 箇条書き / `1.` 番号付きリスト
- `---` 水平線
- フェンス付きコードブロック
- パイプ区切りの表（揃えの `:` とセル内の `\|` を含む）

使えないもの: raw HTML、入れ子リスト、footnote、task list、MDX、frontmatter、syntax highlighting。

HTML は escape します。リンクは `https:` / `http:` / `mailto:` / 相対 URL / `#fragment` だけ通し、`javascript:` などは無効にします。画像の URL は相対と `https:` / `http:` だけです。

日本語の改行では不要な半角空白を入れません。行末 2 スペースは明示的な改行です。

## 表示モード

| モード | アドレス         | 見た目                                                                                             |
| ------ | ---------------- | -------------------------------------------------------------------------------------------------- |
| 組版   | `/`              | A4 1段組。本文は明朝、見出しはゴシック、code は等幅。長いときはおよそ 24 行ごとに頁分け。印刷は A4 |
| 2段    | `/magazine.html` | 同じ原稿を A4 縦2列にする。見出し・リード・コードは全幅。長いときはおよそ 40 行ごとに頁分け        |
| Web    | `/web.html`      | 画面幅に合わせた記事。本文はゴシック                                                               |

切り替えは右上（Web ではヘッダー）から行います。JavaScript は使いません。組版と 2段は画面上でも印刷時でも A4 が積み重なります。保存するとプレビューが追従します。

## 書き出しと GitHub Pages

```bash
./kumihan export manuscript.md --out dist
# リポジトリの原稿なら
bun run export
```

```
dist/
├─ index.html
├─ magazine.html
├─ web.html
├─ shot.png          # 原稿が `![alt](shot.png)` を含むとき
└─ assets/
   ├─ typeset.css
   └─ web.css
```

`main` への push で GitHub Actions が検査したあと GitHub Pages へ載せます。リポジトリの Pages 設定は **GitHub Actions** を選んでください。

## コマンド

| コマンド                | 内容                                                      |
| ----------------------- | --------------------------------------------------------- |
| `kumihan serve [file]`  | プレビューを起動する。既定の原稿は `content/index.md`     |
| `kumihan export [file]` | `dist/*.html` と CSS を生成する。`--out` で出力先を変える |
| `bun run dev`           | リポジトリの `content/index.md` をプレビューする          |
| `bun run export`        | リポジトリの原稿を `dist/` へ書き出す                     |

開発（テスト、lint、ベンチ、内部 API）は [CONTRIBUTING.md](CONTRIBUTING.md) を見てください。脆弱性の報告は [SECURITY.md](SECURITY.md) です。

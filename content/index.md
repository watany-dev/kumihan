# 組版プレビュー

GitHub Codespaces 上で Markdown を編集し、保存した内容をブラウザで確認するための初期環境です。右上から 1段組・2段組・Web を切り替えられます。

これは日本語
の文章です。改行しても不要な空白は入りません。

This is
English. Latin words keep a single space.

## 本文の書き方

本文は明朝系で組まれ、行長は A4 縦位置の横幅に合わせています。2段組では同じ原稿がページ内の縦2列に流れます。**強調**や*斜体*、`inline code` も使えます。

詳しい仕様は [GitHub](https://github.com/watany-dev/kumihan) を参照してください。

### 引用とリスト

> 原稿の履歴は Git に任せます。working tree が編集中、commit が revision です。

- 見出し
- 段落
- リンク

1. Markdown を保存する
2. ブラウザを更新する
3. 組版結果を確認する

---

## コード

フェンス付きコードブロックは等幅で、折り返し可能です。2段組では段をまたいで全幅に置きます。

```ts
const value = 1
```

# プレビューの追従（issue 22）

プレビューの HTML 応答にだけ `Refresh: 2` を付ける。JavaScript もファイル監視も renderer も触らない。

## なぜこれか

開いているブラウザに変更を知らせる手段は、JS 無しでは「同じ URL を定期的に再取得」しかない。`GET /` はすでに毎回ファイルを読み直す。表示モードはパスで決まっているので、今の URL を再読み込みすれば組版 / 2段 / Web は維持される。

ファイル監視はサーバ側の話で、開いたままのタブには届かない。小さな reload スクリプトは `script-src 'none'` を緩める。どちらも issue の完了条件に対して余分。

## やること

`createPreviewApp` で、`Content-Type` が `text/html` の応答（200 / 404 / 500）へ `Refresh: 2` を付ける。`secure-headers` のあとでもヘッダが残るようにする。間隔は秒、URL は付けない（今のパスを再取得する）。

原稿 HTML もエラーページも対象。サーバ起動時点でファイルが無く、あとから置いたときも拾う。

## やらないこと

- `script-src` を開けること。hash / nonce の小さなスクリプトも含む
- `fs.watch` / SSE / WebSocket
- renderer（`renderDocument`）と export。GitHub Pages の静的 HTML は再読み込みしない
- CSS / `/health` への `Refresh`
- 間隔の設定値、スクロール位置の保持、未変更時の 304

スクロールが戻ることと、保存から最大 2 秒遅れることは既知の上限。保持が必要になったらそのとき `script-src` を hash だけ開けて EventSource にする。

## 完了条件

| 条件 | この設計 |
| --- | --- |
| 保存した原稿が開いているプレビューに出る | 最大 2 秒後の再取得。`Cache-Control: no-store` のまま |
| 表示モードを維持する | `Refresh` に URL を付けない |
| `script-src` を広く開けない | CSP は変更しない |

README の「手動更新」と、同じ趣旨の一文を直す。SECURITY.md の方針（プレビューの CSP）とは矛盾しないので、CSP の記述は増やさない。

## 確認

- `/` `/magazine.html` `/web.html` と 404/500 に `Refresh: 2` がある
- `/assets/*.css` と `/health` には無い
- export した HTML に `Refresh` も `http-equiv="refresh"` も無い
- CSP の `script-src 'none'` はヘッダと `<meta>` のまま

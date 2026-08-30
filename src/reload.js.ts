/**
 * プレビューの自動リロード（ブラウザ側）。
 *
 * ページに埋めた原稿のバージョンを添えて `/events` につなぎ、サーバーが
 * 原稿の変化を知らせてきたらリロードします。読み込みと接続の間に保存が
 * 挟まっても、サーバーがバージョンの食い違いを見てすぐ知らせてくるので、
 * 取りこぼしません。切断されたときの再接続は EventSource が自前で行います。
 */
export const reloadJs = `;(function () {
  'use strict'
  var tag = document.querySelector('script[data-kumihan-version]')
  var version = tag === null ? '' : tag.getAttribute('data-kumihan-version') || ''
  var source = new EventSource('events?v=' + encodeURIComponent(version))
  source.addEventListener('message', function () {
    source.close()
    location.reload()
  })
})()
`

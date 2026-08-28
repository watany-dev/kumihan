import { createPreviewApp } from './app.js'
import { createNodeServer } from './node-server.js'

const app = createPreviewApp({ source: './content/index.md' })

// プレビューは編集中の原稿をそのまま返すので、既定ではループバックだけに
// 待ち受けます。Codespaces と Dev Container のポート転送はこれで届きます。
// LAN の別端末から見たい場合だけ KUMIHAN_HOST で明示的に広げてください。
const host = process.env['KUMIHAN_HOST'] ?? '127.0.0.1'
const port = 3000
const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host

createNodeServer(app).listen(port, host, () => {
  console.log(`Typeset preview: http://${shown}:${port}`)
  console.log(`Two-column preview: http://${shown}:${port}/magazine.html`)
  console.log(`Web article preview: http://${shown}:${port}/web.html`)
})

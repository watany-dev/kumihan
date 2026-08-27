import { createServer } from 'node:http'
import { createPreviewApp } from './app.js'

const app = createPreviewApp({ source: './content/index.md' })

createServer((req, res) => {
  void (async () => {
    try {
      const host = req.headers.host ?? '127.0.0.1'
      const response = await app.fetch(
        new Request(`http://${host}${req.url ?? '/'}`, { method: req.method }),
      )
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      console.error('[kumihan] Unexpected server error:', error)
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Internal Server Error')
    }
  })()
}).listen(3000, '0.0.0.0', () => {
  console.log('Typeset preview: http://127.0.0.1:3000')
})

import { createPreviewApp } from './app.js'
import { createNodeServer } from './node-server.js'

const app = createPreviewApp({ source: './content/index.md' })

createNodeServer(app).listen(3000, '0.0.0.0', () => {
  console.log('Typeset preview: http://127.0.0.1:3000')
  console.log('Two-column preview: http://127.0.0.1:3000/magazine.html')
  console.log('Web article preview: http://127.0.0.1:3000/web.html')
})

import { createPreviewApp } from './app.js'
import { createNodeServer } from './node-server.js'

const app = createPreviewApp({ source: './content/index.md' })

createNodeServer(app).listen(3000, '0.0.0.0', () => {
  console.log('Typeset preview: http://127.0.0.1:3000')
})

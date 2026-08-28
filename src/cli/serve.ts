import { createPreviewApp, type PreviewConfig } from '../app.js'
import { createNodeServer } from '../node-server.js'

export interface PreviewListenOptions {
  source: string
  host: string
  port: number
  title?: string
  language?: string
}

export interface StartedPreview {
  close: () => Promise<void>
  port: number
  url: string
}

export async function startPreviewServer(options: PreviewListenOptions): Promise<StartedPreview> {
  const config: PreviewConfig = { source: options.source }
  if (options.title !== undefined) {
    config.title = options.title
  }
  if (options.language !== undefined) {
    config.language = options.language
  }

  const server = createNodeServer(createPreviewApp(config))

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error)
    }
    server.once('error', onError)
    server.listen(options.port, options.host, () => {
      server.off('error', onError)
      resolve()
    })
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    await closeServer(server)
    throw new Error('プレビューサーバのアドレスを取得できませんでした。')
  }

  const displayHost =
    options.host === '0.0.0.0' || options.host === '::' ? '127.0.0.1' : options.host

  return {
    port: address.port,
    url: `http://${displayHost}:${address.port}`,
    close: () => closeServer(server),
  }
}

function closeServer(server: ReturnType<typeof createNodeServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

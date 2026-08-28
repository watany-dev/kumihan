import { runCommand } from './cli/run.js'

async function main(): Promise<void> {
  const result = await runCommand(process.argv.slice(2), {
    log: (message) => {
      console.log(message)
    },
    error: (message) => {
      console.error(message)
    },
  })

  if (result.close !== undefined) {
    const close = result.close
    const shutdown = () => {
      void close().finally(() => {
        process.exit(0)
      })
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    return
  }

  process.exit(result.code)
}

void main().catch((error: unknown) => {
  console.error('[kumihan] Unexpected error:', error)
  process.exit(1)
})

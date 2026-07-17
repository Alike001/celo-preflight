import { createServer } from 'node:http'
import { createApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const { app, payment } = await createApp(config)
const server = createServer(app)

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Celo Preflight API listening on http://127.0.0.1:${config.port}`)
  console.log(
    payment.enabled
      ? `Hosted x402 claims enabled on ${payment.network} at ${payment.price}`
      : `Local-free mode: ${payment.reason}`,
  )
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)))
}

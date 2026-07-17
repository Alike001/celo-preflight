import type { Address } from '@preflight/shared'

export interface ApiConfig {
  port: number
  dataDir: string
  rpcUrls: Record<42220 | 11142220, string>
  reportSignerPrivateKey?: `0x${string}`
  payment?: {
    facilitatorUrl: string
    payTo: Address
    price: string
  }
}

function paymentConfig(): ApiConfig['payment'] {
  const facilitatorUrl = process.env.X402_FACILITATOR_URL
  const payTo = process.env.X402_PAY_TO
  const price = process.env.X402_PRICE
  if (!facilitatorUrl || !payTo || !price) return undefined
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    throw new Error('X402_PAY_TO must be a 20-byte hex address')
  }
  if (!/^\$\d+(?:\.\d+)?$/.test(price)) {
    throw new Error('X402_PRICE must be a dollar price such as $0.01')
  }
  return { facilitatorUrl, payTo: payTo as Address, price }
}

export function loadConfig(): ApiConfig {
  const signer = process.env.REPORT_SIGNER_PRIVATE_KEY
  if (signer && !/^0x[0-9a-fA-F]{64}$/.test(signer)) {
    throw new Error('REPORT_SIGNER_PRIVATE_KEY must be 32-byte hex')
  }
  const payment = paymentConfig()
  return {
    port: Number(process.env.PORT ?? '3001'),
    dataDir: process.env.DATA_DIR ?? '.data',
    rpcUrls: {
      42220: process.env.CELO_RPC_URL ?? 'https://forno.celo.org',
      11142220: process.env.CELO_SEPOLIA_RPC_URL ?? 'https://forno.celo-sepolia.celo-testnet.org',
    },
    ...(signer ? { reportSignerPrivateKey: signer as `0x${string}` } : {}),
    ...(payment ? { payment } : {}),
  }
}

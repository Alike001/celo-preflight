import { CELO_USDC } from './payment-recovery.js'

export function usdcExactPrice(price: string) {
  const [, whole = '0', fraction = ''] = /^\$(\d+)(?:\.(\d+))?$/.exec(price) ?? []
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6))
  return {
    amount: amount.toString(),
    asset: CELO_USDC,
    extra: { name: 'USDC', version: '2' },
  }
}

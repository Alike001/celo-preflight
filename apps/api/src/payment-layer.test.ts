import { describe, expect, it } from 'vitest'
import { paymentRejectionReason, usdcExactPrice } from './payment-layer.js'

describe('Celo USDC x402 requirements', () => {
  it('uses Celo USDC’s exact EIP-712 signing domain', () => {
    expect(usdcExactPrice('$0.01')).toEqual({
      amount: '10000',
      asset: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
      extra: { name: 'USDC', version: '2' },
    })
  })

  it('extracts the facilitator rejection reason without retaining a payment signature', () => {
    const header = Buffer.from(JSON.stringify({ error: 'Authorization expired.' })).toString(
      'base64',
    )

    expect(paymentRejectionReason(header)).toBe('Authorization expired.')
    expect(paymentRejectionReason('not-a-payment-header')).toBeUndefined()
  })
})

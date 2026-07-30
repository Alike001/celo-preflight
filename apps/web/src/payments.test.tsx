import { describe, expect, it } from 'vitest'
import { paymentError } from './payments.js'

describe('x402 payment error reporting', () => {
  it('surfaces the facilitator rejection reason from a payment-required header', () => {
    const header = btoa(JSON.stringify({ error: 'Invalid USDC authorization signature.' }))
    const response = new Response('{}', { status: 402, headers: { 'payment-required': header } })

    expect(paymentError(response)).toBe('Invalid USDC authorization signature.')
  })

  it('keeps an API error message when one is provided', () => {
    const response = new Response(JSON.stringify({ error: 'Prepared report expired.' }), {
      status: 410,
    })

    expect(paymentError(response, { error: 'Prepared report expired.' })).toBe(
      'Prepared report expired.',
    )
  })
})

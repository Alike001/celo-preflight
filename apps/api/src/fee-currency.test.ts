import { describe, expect, it, vi } from 'vitest'
import { FEE_CURRENCY_DIRECTORIES } from '@preflight/engine'
import { feeCurrencyAllowed } from './fee-currency.js'

const adapter = '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B' as const

describe('Celo fee currency directory', () => {
  it('uses the Mainnet directory when inspecting a Mainnet transaction', async () => {
    const client = {
      readContract: vi.fn(async () => [adapter]),
    }
    await expect(feeCurrencyAllowed(client as never, 42220, adapter, 123n)).resolves.toBe(true)
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: FEE_CURRENCY_DIRECTORIES[42220], blockNumber: 123n }),
    )
  })

  it('fails closed when the directory cannot be read', async () => {
    const client = { readContract: vi.fn(async () => Promise.reject(new Error('RPC unavailable'))) }
    await expect(feeCurrencyAllowed(client as never, 42220, adapter, 123n)).resolves.toBeUndefined()
  })
})

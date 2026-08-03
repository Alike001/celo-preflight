import { describe, expect, it } from 'vitest'
import { createWalletClient, custom } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { celoSepolia } from 'viem/chains'
import {
  CELO_SEPOLIA_USDC,
  findLiveUsdcFeeCurrency,
  normalizedFeeToUsdcBaseUnits,
  parseRecipient,
  parseUsdcAmount,
} from './fee-proof-utils.js'

describe('Celo Sepolia fee proof guards', () => {
  it('uses only the live adapter whose adapted token is native Circle USDC', () => {
    expect(
      findLiveUsdcFeeCurrency([
        {
          address: '0x4822e58de6f5e485eF90df51C41CE01721331dC0',
          adaptedToken: '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B',
        },
        {
          address: '0xbf1441Ea57f43f35f713431001f35742c88071c7',
          adaptedToken: CELO_SEPOLIA_USDC,
        },
      ]),
    ).toEqual({
      address: '0xbf1441Ea57f43f35f713431001f35742c88071c7',
      adaptedToken: CELO_SEPOLIA_USDC,
    })
  })

  it('parses the authorized amount as six-decimal USDC units', () => {
    expect(parseUsdcAmount('0.01', 'Transfer amount')).toBe(10_000n)
    expect(() => parseUsdcAmount('0.0000001', 'Transfer amount')).toThrow(/at most 6/i)
  })

  it('rounds normalized adapter fee values up to USDC base units', () => {
    expect(normalizedFeeToUsdcBaseUnits(1n)).toBe(1n)
    expect(normalizedFeeToUsdcBaseUnits(10n ** 12n)).toBe(1n)
  })

  it('requires a real recipient address', () => {
    expect(parseRecipient('0x2222222222222222222222222222222222222222')).toBe(
      '0x2222222222222222222222222222222222222222',
    )
    expect(() => parseRecipient('not-an-address')).toThrow(/recipient/i)
  })

  it('serializes a locally signed Celo fee-currency transfer as CIP-64', async () => {
    const account = privateKeyToAccount(`0x${'1'.repeat(64)}`)
    const signer = createWalletClient({
      account,
      chain: celoSepolia,
      transport: custom({
        request: async ({ method }) => {
          if (method === 'eth_chainId') return '0xaa044c'
          throw new Error(`Unexpected local signer request: ${method}`)
        },
      }),
    })
    const serialized = await signer.signTransaction({
      nonce: 0,
      gas: 96_007n,
      maxFeePerGas: 78_750_000_000n,
      maxPriorityFeePerGas: 2_500_000_000n,
      to: CELO_SEPOLIA_USDC,
      data: '0x',
      feeCurrency: '0xbf1441Ea57f43f35f713431001f35742c88071c7',
    })

    expect(serialized.startsWith('0x7b')).toBe(true)
  })
})

import { decodeFunctionData, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'
import { createSampleTransaction } from './sample.js'

const transferAbi = parseAbi([
  'function transfer(address recipient, uint256 amount) returns (bool)',
])

describe('judge sample', () => {
  it('is a meaningful bounded native Celo USDC transfer draft, never a broadcast', () => {
    const sample = createSampleTransaction('celo_preflight_test')
    const decoded = decodeFunctionData({
      abi: transferAbi,
      data: sample.data.slice(0, 138) as `0x${string}`,
    })
    expect(sample).toMatchObject({
      chainId: 42220,
      from: '0x1c9d2c90A690Fc6BD326034792Bf87F5af32bb8E',
      to: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
      valueWei: '0',
    })
    expect(decoded).toMatchObject({ functionName: 'transfer', args: expect.any(Array) })
    expect(decoded.args?.[1]).toBe(10_000n)
  })
})

import { describe, expect, it } from 'vitest'
import { toMentoProposal } from './chain-inspector.js'

const owner = '0x1111111111111111111111111111111111111111' as const
const token = '0x765DE816845861e75A25fCA122bb6898B8B1282a' as const
const router = '0x4861840C2EfB2b98312B0aE34d86fD73E8f9B6f6' as const

describe('Mento proposal construction', () => {
  it('keeps a bounded approval and swap as two separate inspectable drafts', () => {
    const proposal = toMentoProposal(owner, { path: [{}] }, true, {
      approval: { to: token, value: '0x0', data: '0x095ea7b3' },
      swap: {
        params: { to: router, value: '0x0', data: '0x12345678' },
        amountIn: 100n,
        expectedAmountOut: 99n,
        amountOutMin: 98n,
        deadline: 1_800_000_000n,
      },
    })
    expect(proposal.approval).toMatchObject({ from: owner, to: token, data: '0x095ea7b3' })
    expect(proposal.transaction).toMatchObject({ from: owner, to: router, data: '0x12345678' })
    expect(proposal.quote).toMatchObject({ hops: 1, tradable: true, minimumAmountOut: '98' })
  })

  it('omits approval only when the SDK says none is required', () => {
    const proposal = toMentoProposal(owner, { path: [{}, {}] }, false, {
      approval: null,
      swap: {
        params: { to: router, value: '0x0', data: '0x12345678' },
        amountIn: 1n,
        expectedAmountOut: 1n,
        amountOutMin: 1n,
        deadline: 2n,
      },
    })
    expect(proposal.approval).toBeUndefined()
    expect(proposal.quote).toMatchObject({ hops: 2, tradable: false })
  })
})

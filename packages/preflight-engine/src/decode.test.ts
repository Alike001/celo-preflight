import { encodeFunctionData, maxUint256, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'
import type { TransactionDraft } from '@preflight/shared'
import { MENTO_ROUTERS } from './constants.js'
import { decodeTransaction, mentoRouterAbi } from './decode.js'

const address = (digit: string) => `0x${digit.repeat(40)}` as const

function transaction(overrides: Partial<TransactionDraft> = {}): TransactionDraft {
  return {
    chainId: 42220,
    from: address('1'),
    to: address('2'),
    valueWei: '0',
    data: '0x',
    ...overrides,
  }
}

describe('decodeTransaction', () => {
  it('decodes a native transfer', () => {
    expect(decodeTransaction(transaction({ valueWei: '42' }))).toEqual({
      kind: 'native-transfer',
      recipient: address('2'),
      amount: '42',
    })
  })

  it('decodes an ERC-20 approval', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']),
      functionName: 'approve',
      args: [address('3'), maxUint256],
    })
    expect(decodeTransaction(transaction({ data }))).toMatchObject({
      kind: 'erc20-approve',
      spender: address('3'),
      amount: maxUint256.toString(),
    })
  })

  it('decodes an ERC-20 transfer', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function transfer(address recipient, uint256 amount) returns (bool)']),
      functionName: 'transfer',
      args: [address('4'), 25n],
    })
    expect(decodeTransaction(transaction({ data }))).toEqual({
      kind: 'erc20-transfer',
      token: address('2'),
      recipient: address('4'),
      amount: '25',
    })
  })

  it('decodes the current Mento Router swap shape', () => {
    const route = {
      from: address('3'),
      to: address('4'),
      factory: address('5'),
    }
    const data = encodeFunctionData({
      abi: mentoRouterAbi,
      functionName: 'swapExactTokensForTokens',
      args: [100n, 98n, [route], address('6'), 2_000_000_000n],
    })
    expect(decodeTransaction(transaction({ to: MENTO_ROUTERS[42220], data }))).toEqual({
      kind: 'mento-swap',
      router: MENTO_ROUTERS[42220],
      amountIn: '100',
      amountOutMin: '98',
      routes: [route],
      recipient: address('6'),
      deadline: '2000000000',
    })
  })

  it('labels unsupported calls without inferring intent', () => {
    expect(decodeTransaction(transaction({ data: '0x12345678' }))).toEqual({
      kind: 'unknown',
      selector: '0x12345678',
      reason: 'Contract call selector is not supported by this ruleset',
    })
  })

  it('labels unsupported Mento Router calls specifically', () => {
    expect(
      decodeTransaction(
        transaction({
          to: MENTO_ROUTERS[11142220],
          chainId: 11142220,
          data: '0x12345678',
        }),
      ),
    ).toMatchObject({
      kind: 'unknown',
      reason: 'Mento Router call is not supported by this ruleset',
    })
  })
})

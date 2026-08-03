import { toDataSuffix } from '@celo/attribution-tags'
import { concat, encodeFunctionData, parseAbi } from 'viem'
import type { TransactionDraft } from '@preflight/shared'

const transferAbi = parseAbi([
  'function transfer(address recipient, uint256 amount) returns (bool)',
])

export function createSampleTransaction(requiredAttributionCode?: string): TransactionDraft {
  const call = encodeFunctionData({
    abi: transferAbi,
    functionName: 'transfer',
    // A real, bounded native Celo USDC transfer between the public evidence
    // wallets. This stays unsigned and Preflight never broadcasts it.
    args: ['0x20Bff5B3BF2247eA4671fc946ee2ec2a1aa0Cd5B', 10_000n],
  })
  return {
    chainId: 42220,
    from: '0x1c9d2c90A690Fc6BD326034792Bf87F5af32bb8E',
    to: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    valueWei: '0',
    data: requiredAttributionCode ? concat([call, toDataSuffix(requiredAttributionCode)]) : call,
  }
}

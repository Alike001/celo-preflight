import { toDataSuffix } from '@celo/attribution-tags'
import { concat, encodeFunctionData, parseAbi } from 'viem'
import type { TransactionDraft } from '@preflight/shared'

const transferAbi = parseAbi([
  'function transfer(address recipient, uint256 amount) returns (bool)',
])

export function createSampleTransaction(): TransactionDraft {
  const call = encodeFunctionData({
    abi: transferAbi,
    functionName: 'transfer',
    args: ['0x2222222222222222222222222222222222222222', 0n],
  })
  return {
    chainId: 42220,
    from: '0x1111111111111111111111111111111111111111',
    to: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
    valueWei: '0',
    data: concat([call, toDataSuffix('celo_preflight')]),
  }
}

import type { SupportedChainId, TransactionDraft } from '@preflight/shared'

export function emptyTransaction(chainId: SupportedChainId = 42220): TransactionDraft {
  return {
    chainId,
    from: '' as `0x${string}`,
    to: '' as `0x${string}`,
    valueWei: '0',
    data: '0x',
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The inspection could not be completed.'
}

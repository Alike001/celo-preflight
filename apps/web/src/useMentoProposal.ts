import type { Dispatch, SetStateAction } from 'react'
import type { TransactionDraft } from '@preflight/shared'
import { getLiveMentoProposal } from './api.js'
import { errorMessage } from './app-utils.js'
import type { FormStatus } from './components/TransactionForm.js'

interface UseMentoProposalOptions {
  address?: `0x${string}` | undefined
  setPendingSwap: Dispatch<SetStateAction<TransactionDraft | undefined>>
  setTransaction: Dispatch<SetStateAction<TransactionDraft>>
  setStatus: Dispatch<SetStateAction<FormStatus>>
  setMessage: Dispatch<SetStateAction<string | undefined>>
}

export function useMentoProposal({
  address,
  setPendingSwap,
  setTransaction,
  setStatus,
  setMessage,
}: UseMentoProposalOptions) {
  return async function buildMentoProposal() {
    if (!address) return
    setStatus('preparing')
    setMessage('Building a fresh USDm → KESm Mento route from current Celo state…')
    try {
      const proposal = await getLiveMentoProposal(address)
      setPendingSwap(proposal.transaction)
      setTransaction(proposal.approval ?? proposal.transaction)
      setStatus('idle')
      setMessage(
        proposal.approval
          ? 'Step 1 of 2 loaded: inspect the bounded USDm approval first. After it is confirmed externally, build a fresh route before using the swap draft.'
          : `Live Mento swap loaded: ${proposal.quote.hops} hop, ${proposal.quote.tradable ? 'tradable' : 'not tradable'}.`,
      )
    } catch (error) {
      setStatus('error')
      setMessage(errorMessage(error))
    }
  }
}

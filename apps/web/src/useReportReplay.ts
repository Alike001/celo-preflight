import type { Dispatch, SetStateAction } from 'react'
import type { PreparedReport } from '@preflight/shared'
import { replayReport } from './api.js'
import { errorMessage } from './app-utils.js'
import type { FormStatus } from './components/TransactionForm.js'

interface UseReportReplayOptions {
  report?: PreparedReport | undefined
  setReport: Dispatch<SetStateAction<PreparedReport | undefined>>
  setSelectedCheckId: Dispatch<SetStateAction<string | undefined>>
  setStatus: Dispatch<SetStateAction<FormStatus>>
  setMessage: Dispatch<SetStateAction<string | undefined>>
}

export function useReportReplay({
  report,
  setReport,
  setSelectedCheckId,
  setStatus,
  setMessage,
}: UseReportReplayOptions) {
  return async function replaySnapshot() {
    if (!report) return
    setStatus('preparing')
    setMessage(`Re-running at recorded Celo block ${report.facts.snapshot.blockNumber}…`)
    try {
      const replay = await replayReport(report.id)
      const replayed: PreparedReport = {
        ...report,
        facts: replay.facts,
        verdict: replay.verdict,
        checks: replay.checks,
      }
      setReport(replayed)
      setSelectedCheckId(replayed.checks[0]?.id)
      setStatus('complete')
      setMessage(`Re-run completed at original Celo block ${replayed.facts.snapshot.blockNumber}.`)
    } catch (error) {
      setStatus('error')
      setMessage(errorMessage(error))
    }
  }
}

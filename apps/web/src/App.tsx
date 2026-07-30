import { useEffect, useRef, useState, startTransition } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, usePublicClient, useSwitchChain } from 'wagmi'
import { getWalletClient } from 'wagmi/actions'
import type { PublicClient, WalletClient } from 'viem'
import type { PreparedReport, TransactionDraft, Verdict } from '@preflight/shared'
import {
  getCapabilities,
  getHistory,
  getLiveMentoProposal,
  getReport,
  prepareReport,
  replayReport,
} from './api.js'
import { createSampleTransaction } from './sample.js'
import { isReportExpired } from './report-freshness.js'
import { emptyTransaction, errorMessage } from './app-utils.js'
import { wagmiConfig } from './wagmi.js'
import { ChecksTable } from './components/ChecksTable.js'
import { DocsDialog } from './components/DocsDialog.js'
import { EvidenceInspector } from './components/EvidenceInspector.js'
import { ExecutionPath } from './components/ExecutionPath.js'
import { InspectionRail } from './components/InspectionRail.js'
import { LandingState } from './components/LandingState.js'
import { StateFooter } from './components/StateFooter.js'
import { TopBar } from './components/TopBar.js'
import { TransactionForm, type FormStatus } from './components/TransactionForm.js'
export function App() {
  const queryClient = useQueryClient()
  const capabilities = useQuery({ queryKey: ['capabilities'], queryFn: getCapabilities })
  const history = useQuery({ queryKey: ['history'], queryFn: getHistory })
  const [transaction, setTransaction] = useState<TransactionDraft>(() => emptyTransaction())
  const [report, setReport] = useState<PreparedReport>()
  const [selectedCheckId, setSelectedCheckId] = useState<string>()
  const [selectedReportId, setSelectedReportId] = useState<string>()
  const [filter, setFilter] = useState<'ALL' | Verdict>('ALL')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [statusMessage, setStatusMessage] = useState<string>()
  const [showLanding, setShowLanding] = useState(true)
  const [showDocs, setShowDocs] = useState(false)
  const [pendingMentoSwap, setPendingMentoSwap] = useState<TransactionDraft>()
  const fromRef = useRef<HTMLInputElement>(null)
  const shouldFocusForm = useRef(false)
  const account = useAccount()
  const publicClient = usePublicClient({ chainId: 42220 })
  const { switchChainAsync } = useSwitchChain()
  function newInspection() {
    shouldFocusForm.current = true
    startTransition(() => {
      setShowLanding(false)
      setTransaction(emptyTransaction(transaction.chainId))
      setReport(undefined)
      setSelectedReportId(undefined)
      setSelectedCheckId(undefined)
      setStatus('idle')
      setStatusMessage(undefined)
    })
  }
  useEffect(() => {
    if (!showLanding && shouldFocusForm.current && fromRef.current) {
      fromRef.current.focus()
      shouldFocusForm.current = false
    }
  }, [showLanding])
  useEffect(() => {
    function keyboardShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (event.key.toLowerCase() === 'n' && !target?.matches('input, textarea, select')) {
        event.preventDefault()
        newInspection()
      }
    }
    window.addEventListener('keydown', keyboardShortcut)
    return () => window.removeEventListener('keydown', keyboardShortcut)
  })

  async function runPreflight(draft: TransactionDraft = transaction) {
    setShowLanding(false)
    setStatus('preparing')
    setStatusMessage('Reading a Celo snapshot and running deterministic rules…')
    try {
      const prepared = await prepareReport(draft)
      let nextReport = prepared.report
      if (prepared.claimRequired) {
        if (!account.isConnected || !account.address || !publicClient) {
          setStatus('awaiting-wallet')
          setStatusMessage(
            `Report prepared as ${prepared.prepared.verdict}. Connect a wallet to claim it via ${capabilities.data?.payment.price ?? 'x402'}.`,
          )
          return
        }
        if (account.chainId !== 42220) await switchChainAsync({ chainId: 42220 })
        const walletClient = await getWalletClient(wagmiConfig, {
          account: account.address,
          chainId: 42220,
        })
        setStatus('signing-payment')
        setStatusMessage(
          'Authorize the exact x402 payment in your wallet. No transaction is sent by Preflight.',
        )
        const { claimReportWithX402 } = await import('./payments.js')
        nextReport = await claimReportWithX402(
          prepared.prepared.id,
          walletClient as unknown as WalletClient,
          publicClient as unknown as PublicClient,
        )
      }
      if (!nextReport) throw new Error('The API returned no report.')
      setReport(nextReport)
      setSelectedReportId(nextReport.id)
      setSelectedCheckId(nextReport.checks[0]?.id)
      setStatus('complete')
      setStatusMessage(
        `${nextReport.verdict} at Celo block ${nextReport.facts.snapshot.blockNumber}. Select any check to verify why.`,
      )
      await queryClient.invalidateQueries({ queryKey: ['history'] })
    } catch (error) {
      setStatus('error')
      setStatusMessage(errorMessage(error))
    }
  }

  async function selectReport(id: string) {
    setShowLanding(false)
    setSelectedReportId(id)
    setStatus('preparing')
    setStatusMessage('Loading signed report…')
    try {
      const selected = await getReport(id)
      setReport(selected)
      setSelectedCheckId(selected.checks[0]?.id)
      setStatus('complete')
      setStatusMessage(
        isReportExpired(selected)
          ? `Historical ${selected.verdict} from Celo block ${selected.facts.snapshot.blockNumber}. It is expired and is not signing guidance.`
          : `${selected.verdict} at Celo block ${selected.facts.snapshot.blockNumber}.`,
      )
    } catch (error) {
      setStatus('error')
      setStatusMessage(errorMessage(error))
    }
  }

  async function replaySnapshot() {
    if (!report) return
    setStatus('preparing')
    setStatusMessage(`Re-running at recorded Celo block ${report.facts.snapshot.blockNumber}…`)
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
      setStatusMessage(
        `Re-run completed at original Celo block ${replayed.facts.snapshot.blockNumber}.`,
      )
    } catch (error) {
      setStatus('error')
      setStatusMessage(errorMessage(error))
    }
  }

  async function buildMentoProposal() {
    if (!account.address) return
    setStatus('preparing')
    setStatusMessage('Building a fresh USDm → KESm Mento route from current Celo state…')
    try {
      const proposal = await getLiveMentoProposal(account.address)
      setPendingMentoSwap(proposal.transaction)
      setTransaction(proposal.approval ?? proposal.transaction)
      setStatus('idle')
      setStatusMessage(
        proposal.approval
          ? `Step 1 of 2 loaded: inspect the bounded USDm approval first. After it is confirmed externally, build a fresh route before using the swap draft.`
          : `Live Mento swap loaded: ${proposal.quote.hops} hop, ${proposal.quote.tradable ? 'tradable' : 'not tradable'}.`,
      )
    } catch (error) {
      setStatus('error')
      setStatusMessage(errorMessage(error))
    }
  }

  const selectedCheck = report?.checks.find((check) => check.id === selectedCheckId)
  const capabilityMessage = capabilities.error ? errorMessage(capabilities.error) : undefined
  const freshVerifiedReportId = history.data?.find(
    (candidate) => candidate.paid && !isReportExpired(candidate),
  )?.id
  const historicalPaidReportId = history.data?.find((candidate) => candidate.paid)?.id

  return (
    <div className="app-shell">
      <TopBar
        chainId={transaction.chainId}
        onChainChange={(chainId) => setTransaction({ ...transaction, chainId })}
        onOpenDocs={() => setShowDocs(true)}
      />
      <main className="workspace">
        <InspectionRail
          reports={history.data ?? []}
          isLoading={history.isPending}
          error={history.error ? errorMessage(history.error) : undefined}
          selectedId={selectedReportId}
          filter={filter}
          onFilter={setFilter}
          onSelect={(id) => void selectReport(id)}
          onNew={newInspection}
          onRetry={() => void history.refetch()}
        />
        <div className="center-pane">
          {showLanding ? (
            <LandingState
              onLoadSample={() => {
                const sample = createSampleTransaction(capabilities.data?.attribution.requiredCode)
                setTransaction(sample)
                setShowLanding(false)
                setStatus('idle')
                setStatusMessage('Sample input loaded. Review it, then explicitly run preflight.')
              }}
              onInspect={newInspection}
              {...(freshVerifiedReportId
                ? { onViewVerified: () => void selectReport(freshVerifiedReportId) }
                : historicalPaidReportId
                  ? { onViewHistorical: () => void selectReport(historicalPaidReportId) }
                  : {})}
              evidenceState={
                history.isPending
                  ? 'loading'
                  : history.error
                    ? 'unavailable'
                    : historicalPaidReportId
                      ? 'historical-only'
                      : 'none'
              }
            />
          ) : (
            <>
              <TransactionForm
                ref={fromRef}
                value={transaction}
                capabilities={capabilities.data}
                status={status}
                message={statusMessage ?? capabilityMessage}
                onChange={setTransaction}
                onSubmit={() => void runPreflight()}
                onSample={() => {
                  setTransaction(
                    createSampleTransaction(capabilities.data?.attribution.requiredCode),
                  )
                  setStatus('idle')
                  setStatusMessage(
                    capabilities.data?.attribution.configured
                      ? 'Sample input loaded with the configured organizer tag. The result is not precomputed.'
                      : 'Sample input loaded without an attribution tag. It will truthfully show that Track 1 credit is unproven.',
                  )
                }}
                onReset={() => setTransaction(emptyTransaction(transaction.chainId))}
                connectedAddress={account.address}
                onUseConnectedAddress={(address) =>
                  setTransaction({ ...transaction, from: address })
                }
                onBuildMento={() => void buildMentoProposal()}
                onLoadMentoSwap={
                  pendingMentoSwap
                    ? () => {
                        setTransaction(pendingMentoSwap)
                        setStatus('idle')
                        setStatusMessage(
                          'Step 2 draft loaded. Inspect it against a fresh Celo snapshot; rebuild the route after any approval is confirmed.',
                        )
                      }
                    : undefined
                }
              />
              <ExecutionPath decoded={report?.facts.decoded} />
              <ChecksTable
                checks={report?.checks}
                selectedId={selectedCheckId}
                onSelect={setSelectedCheckId}
              />
              <StateFooter report={report} />
            </>
          )}
        </div>
        <EvidenceInspector
          report={report}
          selectedCheck={selectedCheck}
          landing={showLanding}
          onReplay={() => void replaySnapshot()}
        />
      </main>
      <DocsDialog open={showDocs} onClose={() => setShowDocs(false)} />
    </div>
  )
}

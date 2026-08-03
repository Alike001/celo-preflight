import { useEffect, useRef, useState, startTransition } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, usePublicClient, useSwitchChain } from 'wagmi'
import { getWalletClient } from 'wagmi/actions'
import type { PublicClient, WalletClient } from 'viem'
import type { PreparedReport, TransactionDraft, Verdict } from '@preflight/shared'
import { getCapabilities, getHistory, getReport, prepareReport } from './api.js'
import { createSampleTransaction } from './sample.js'
import { isReportExpired } from './report-freshness.js'
import { useMentoProposal } from './useMentoProposal.js'
import { useNewInspectionShortcut } from './useNewInspectionShortcut.js'
import { useReportReplay } from './useReportReplay.js'
import { emptyTransaction, errorMessage } from './app-utils.js'
import { wagmiConfig } from './wagmi.js'
import { CenterPane } from './components/CenterPane.js'
import { DocsDialog } from './components/DocsDialog.js'
import { EvidenceInspector } from './components/EvidenceInspector.js'
import { InspectionRail } from './components/InspectionRail.js'
import { TopBar } from './components/TopBar.js'
import type { FormStatus } from './components/TransactionForm.js'
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
  const [pendingClaimId, setPendingClaimId] = useState<string>()
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
      setPendingClaimId(undefined)
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
  useNewInspectionShortcut(newInspection)

  async function runPreflight(draft: TransactionDraft = transaction) {
    setShowLanding(false)
    setStatus('preparing')
    setStatusMessage('Reading a Celo snapshot and running deterministic rules…')
    try {
      const prepared = await prepareReport(draft)
      if (prepared.claimRequired) {
        if (!prepared.preview) throw new Error('The API did not return an inspection preview.')
        const preview: PreparedReport = { ...prepared.prepared, ...prepared.preview }
        setReport(preview)
        setPendingClaimId(prepared.prepared.id)
        setSelectedReportId(prepared.prepared.id)
        setSelectedCheckId(preview.checks[0]?.id)
        setStatus('awaiting-claim')
        setStatusMessage(
          `${preview.verdict} preview at Celo block ${preview.facts.snapshot.blockNumber}. Review the evidence, then explicitly claim the signed report only if you need it.`,
        )
        return
      }
      const nextReport = prepared.report
      if (!nextReport) throw new Error('The API returned no report.')
      setReport(nextReport)
      setPendingClaimId(undefined)
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

  async function claimSignedReport() {
    if (!pendingClaimId) return
    if (!account.isConnected || !account.address || !publicClient) {
      setStatus('awaiting-wallet')
      setStatusMessage(
        'Connect a Celo wallet from the top bar, then explicitly claim this signed report.',
      )
      return
    }
    setStatus('signing-payment')
    setStatusMessage(
      'Authorize the exact x402 payment in your wallet. No transaction is sent by Preflight.',
    )
    try {
      if (account.chainId !== 42220) await switchChainAsync({ chainId: 42220 })
      const walletClient = await getWalletClient(wagmiConfig, {
        account: account.address,
        chainId: 42220,
      })
      const { claimReportWithX402 } = await import('./payments.js')
      const claimed = await claimReportWithX402(
        pendingClaimId,
        walletClient as unknown as WalletClient,
        publicClient as unknown as PublicClient,
      )
      setReport(claimed)
      setPendingClaimId(undefined)
      setSelectedReportId(claimed.id)
      setSelectedCheckId(claimed.checks[0]?.id)
      setStatus('complete')
      setStatusMessage(
        `${claimed.verdict} at Celo block ${claimed.facts.snapshot.blockNumber}. Signed report and settlement receipt claimed.`,
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
      setPendingClaimId(undefined)
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

  const replaySnapshot = useReportReplay({
    report,
    setReport,
    setSelectedCheckId,
    setStatus,
    setMessage: setStatusMessage,
  })
  const buildMentoProposal = useMentoProposal({
    address: account.address,
    setPendingSwap: setPendingMentoSwap,
    setTransaction,
    setStatus,
    setMessage: setStatusMessage,
  })

  const capabilityMessage = capabilities.error ? errorMessage(capabilities.error) : undefined
  const freshVerifiedReportId = history.data?.find(
    (candidate) => candidate.paid && !isReportExpired(candidate),
  )?.id
  const historicalPaidReportId = history.data?.find((candidate) => candidate.paid)?.id

  return (
    <div className="app-shell">
      <TopBar
        chainId={transaction.chainId}
        onChainChange={(chainId) => {
          setTransaction({ ...transaction, chainId })
          setReport(undefined)
          setSelectedCheckId(undefined)
          setPendingClaimId(undefined)
          setStatus('idle')
          setStatusMessage('Network changed. Run a fresh inspection before claiming a report.')
        }}
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
        <CenterPane
          showLanding={showLanding}
          transaction={transaction}
          capabilities={capabilities.data}
          status={status}
          message={statusMessage ?? capabilityMessage}
          report={report}
          selectedCheckId={selectedCheckId}
          pendingClaimId={pendingClaimId}
          pendingMentoSwap={pendingMentoSwap}
          connectedAddress={account.address}
          formRef={fromRef}
          landingEvidenceState={
            history.isPending
              ? 'loading'
              : history.error
                ? 'unavailable'
                : historicalPaidReportId && !freshVerifiedReportId
                  ? 'historical-only'
                  : 'none'
          }
          onLoadSample={() => {
            setTransaction(createSampleTransaction(capabilities.data?.attribution.requiredCode))
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
          onChange={(next) => {
            setTransaction(next)
            if (pendingClaimId) {
              setReport(undefined)
              setPendingClaimId(undefined)
              setSelectedCheckId(undefined)
              setStatus('idle')
              setStatusMessage('Input changed. Run a fresh inspection before claiming a report.')
            }
          }}
          onSubmit={() => void runPreflight()}
          onClaim={() => void claimSignedReport()}
          onSample={() => {
            setTransaction(createSampleTransaction(capabilities.data?.attribution.requiredCode))
            setReport(undefined)
            setPendingClaimId(undefined)
            setSelectedCheckId(undefined)
            setStatus('idle')
            setStatusMessage(
              capabilities.data?.attribution.configured
                ? 'Sample input loaded: a bounded, unsigned $0.01 native Celo USDC transfer with the configured organizer tag. The result is not precomputed and Preflight never broadcasts it.'
                : 'Sample input loaded without an attribution tag. It will truthfully show that Track 1 credit is unproven.',
            )
          }}
          onReset={() => {
            setTransaction(emptyTransaction(transaction.chainId))
            setReport(undefined)
            setPendingClaimId(undefined)
            setSelectedCheckId(undefined)
            setStatus('idle')
            setStatusMessage(undefined)
          }}
          onUseConnectedAddress={(address) => setTransaction({ ...transaction, from: address })}
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
          onSelectCheck={setSelectedCheckId}
        />
        <EvidenceInspector
          report={report}
          selectedCheck={report?.checks.find((check) => check.id === selectedCheckId)}
          landing={showLanding}
          onReplay={report?.signature ? () => void replaySnapshot() : undefined}
        />
      </main>
      <DocsDialog open={showDocs} onClose={() => setShowDocs(false)} />
    </div>
  )
}

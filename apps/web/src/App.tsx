import { useEffect, useRef, useState, startTransition } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi'
import type { PublicClient, WalletClient } from 'viem'
import type { PreparedReport, SupportedChainId, TransactionDraft, Verdict } from '@preflight/shared'
import {
  getCapabilities,
  getHistory,
  getLiveMentoProposal,
  getReport,
  prepareReport,
} from './api.js'
import { createSampleTransaction } from './sample.js'
import { ChecksTable } from './components/ChecksTable.js'
import { DocsDialog } from './components/DocsDialog.js'
import { EvidenceInspector } from './components/EvidenceInspector.js'
import { ExecutionPath } from './components/ExecutionPath.js'
import { InspectionRail } from './components/InspectionRail.js'
import { LandingState } from './components/LandingState.js'
import { TopBar } from './components/TopBar.js'
import { TransactionForm, type FormStatus } from './components/TransactionForm.js'

function emptyTransaction(chainId: SupportedChainId = 42220): TransactionDraft {
  return {
    chainId,
    from: '' as `0x${string}`,
    to: '' as `0x${string}`,
    valueWei: '0',
    data: '0x',
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The inspection could not be completed.'
}

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
  const fromRef = useRef<HTMLInputElement>(null)
  const shouldFocusForm = useRef(false)
  const account = useAccount()
  const wallet = useWalletClient({ chainId: 42220 })
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
        if (!account.isConnected || !wallet.data || !publicClient) {
          setStatus('awaiting-wallet')
          setStatusMessage(
            `Report prepared as ${prepared.prepared.verdict}. Connect a wallet to claim it via ${capabilities.data?.payment.price ?? 'x402'}.`,
          )
          return
        }
        if (account.chainId !== 42220) await switchChainAsync({ chainId: 42220 })
        setStatus('signing-payment')
        setStatusMessage(
          'Authorize the exact x402 payment in your wallet. No transaction is sent by Preflight.',
        )
        const { claimReportWithX402 } = await import('./payments.js')
        nextReport = await claimReportWithX402(
          prepared.prepared.id,
          wallet.data as unknown as WalletClient,
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
      setStatusMessage(message(error))
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
      setStatusMessage(`${selected.verdict} at Celo block ${selected.facts.snapshot.blockNumber}.`)
    } catch (error) {
      setStatus('error')
      setStatusMessage(message(error))
    }
  }

  async function buildMentoProposal() {
    if (!account.address) return
    setStatus('preparing')
    setStatusMessage('Building a fresh USDm → KESm Mento route from current Celo state…')
    try {
      const proposal = await getLiveMentoProposal(account.address)
      setTransaction(proposal.transaction)
      setStatus('idle')
      setStatusMessage(
        `Live Mento route loaded: ${proposal.quote.hops} hop, ${proposal.quote.tradable ? 'tradable' : 'not tradable'}, ${proposal.approvalRequired ? 'approval required before swap.' : 'no approval required.'}`,
      )
    } catch (error) {
      setStatus('error')
      setStatusMessage(message(error))
    }
  }

  const selectedCheck = report?.checks.find((check) => check.id === selectedCheckId)
  const capabilityMessage = capabilities.error ? message(capabilities.error) : undefined

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
          selectedId={selectedReportId}
          filter={filter}
          onFilter={setFilter}
          onSelect={(id) => void selectReport(id)}
          onNew={newInspection}
        />
        <div className="center-pane">
          {showLanding ? (
            <LandingState
              onRunSample={() => {
                const sample = createSampleTransaction(capabilities.data?.attribution.requiredCode)
                setTransaction(sample)
                void runPreflight(sample)
              }}
              onInspect={newInspection}
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
              />
              <ExecutionPath decoded={report?.facts.decoded} />
              <ChecksTable
                checks={report?.checks}
                selectedId={selectedCheckId}
                onSelect={setSelectedCheckId}
              />
              <footer className="state-footer">
                <span>
                  {report
                    ? `Snapshot block ${report.facts.snapshot.blockNumber}`
                    : 'No chain state read yet'}
                </span>
                <span className="mono">
                  {report?.facts.snapshot.stateNote ?? 'Evidence state will be disclosed here.'}
                </span>
              </footer>
            </>
          )}
        </div>
        <EvidenceInspector report={report} selectedCheck={selectedCheck} landing={showLanding} />
      </main>
      <DocsDialog open={showDocs} onClose={() => setShowDocs(false)} />
    </div>
  )
}

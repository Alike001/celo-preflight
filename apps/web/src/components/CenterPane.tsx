import type { RefObject } from 'react'
import type { PreparedReport, TransactionDraft } from '@preflight/shared'
import type { Capabilities } from '../api.js'
import { ChecksTable } from './ChecksTable.js'
import { ExecutionPath } from './ExecutionPath.js'
import { LandingState } from './LandingState.js'
import { StateFooter } from './StateFooter.js'
import { TransactionForm, type FormStatus } from './TransactionForm.js'

interface CenterPaneProps {
  showLanding: boolean
  transaction: TransactionDraft
  capabilities?: Capabilities | undefined
  status: FormStatus
  message?: string | undefined
  report?: PreparedReport | undefined
  selectedCheckId?: string | undefined
  pendingClaimId?: string | undefined
  pendingMentoSwap?: TransactionDraft | undefined
  connectedAddress?: `0x${string}` | undefined
  formRef: RefObject<HTMLInputElement | null>
  landingEvidenceState: 'loading' | 'unavailable' | 'historical-only' | 'none'
  onLoadSample: () => void
  onInspect: () => void
  onViewVerified?: (() => void) | undefined
  onViewHistorical?: (() => void) | undefined
  onChange: (transaction: TransactionDraft) => void
  onSubmit: () => void
  onClaim?: (() => void) | undefined
  onSample: () => void
  onReset: () => void
  onUseConnectedAddress: (address: `0x${string}`) => void
  onBuildMento: () => void
  onLoadMentoSwap?: (() => void) | undefined
  onSelectCheck: (id: string) => void
}

export function CenterPane({
  showLanding,
  transaction,
  capabilities,
  status,
  message,
  report,
  selectedCheckId,
  pendingClaimId,
  pendingMentoSwap,
  connectedAddress,
  formRef,
  landingEvidenceState,
  onLoadSample,
  onInspect,
  onViewVerified,
  onViewHistorical,
  onChange,
  onSubmit,
  onClaim,
  onSample,
  onReset,
  onUseConnectedAddress,
  onBuildMento,
  onLoadMentoSwap,
  onSelectCheck,
}: CenterPaneProps) {
  return (
    <div className="center-pane">
      {showLanding ? (
        <LandingState
          onLoadSample={onLoadSample}
          onInspect={onInspect}
          {...(onViewVerified ? { onViewVerified } : onViewHistorical ? { onViewHistorical } : {})}
          evidenceState={landingEvidenceState}
        />
      ) : (
        <>
          <TransactionForm
            ref={formRef}
            value={transaction}
            capabilities={capabilities}
            status={status}
            message={message}
            onChange={onChange}
            onSubmit={onSubmit}
            {...(pendingClaimId && onClaim
              ? { onClaim, claimPrice: capabilities?.payment.price }
              : {})}
            onSample={onSample}
            onReset={onReset}
            connectedAddress={connectedAddress}
            onUseConnectedAddress={onUseConnectedAddress}
            onBuildMento={onBuildMento}
            onLoadMentoSwap={pendingMentoSwap ? onLoadMentoSwap : undefined}
          />
          <ExecutionPath decoded={report?.facts.decoded} />
          <ChecksTable
            checks={report?.checks}
            selectedId={selectedCheckId}
            onSelect={onSelectCheck}
          />
          <StateFooter report={report} />
        </>
      )}
    </div>
  )
}

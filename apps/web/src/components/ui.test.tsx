import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PreparedReport, TransactionDraft } from '@preflight/shared'
import { ChecksTable } from './ChecksTable.js'
import { DocsDialog } from './DocsDialog.js'
import { EvidenceInspector } from './EvidenceInspector.js'
import { InspectionRail } from './InspectionRail.js'
import { LandingState } from './LandingState.js'
import { TransactionForm } from './TransactionForm.js'

const transaction: TransactionDraft = {
  chainId: 42220,
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  valueWei: '0',
  data: '0x',
}

const report: PreparedReport = {
  id: 'report-test',
  requestHash: `0x${'1'.repeat(64)}`,
  rulesetVersion: 'celo-preflight/1.0.0',
  verdict: 'BLOCK',
  createdAt: '2026-07-17T00:00:00.000Z',
  expiresAt: '2999-07-17T00:10:00.000Z',
  issuer: '0x9999999999999999999999999999999999999999',
  facts: {
    transaction,
    snapshot: { blockNumber: '123', observedAt: 1_700_000_000 },
    simulation: { status: 'revert', error: 'execution reverted' },
    decoded: { kind: 'native-transfer', recipient: transaction.to, amount: '0' },
    attributionCodes: [],
  },
  checks: [
    {
      id: 'SIMULATION',
      title: 'Transaction simulation',
      status: 'FAIL',
      summary: 'The transaction reverted during simulation.',
      details: { error: 'execution reverted' },
    },
  ],
}

const currentClearReport: PreparedReport = {
  ...report,
  verdict: 'CLEAR',
  expiresAt: '2999-01-01T00:00:00.000Z',
}

describe('Flight Deck controls', () => {
  it('makes the real sample and manual inspection paths explicit', () => {
    const onLoadSample = vi.fn()
    const onInspect = vi.fn()
    const onViewVerified = vi.fn()
    render(
      <LandingState
        onLoadSample={onLoadSample}
        onInspect={onInspect}
        onViewVerified={onViewVerified}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load live sample' }))
    fireEvent.click(screen.getByRole('button', { name: 'Inspect your transaction' }))
    fireEvent.click(screen.getByRole('button', { name: 'View current verified report' }))
    expect(onLoadSample).toHaveBeenCalledOnce()
    expect(onInspect).toHaveBeenCalledOnce()
    expect(onViewVerified).toHaveBeenCalledOnce()
    expect(
      screen.getByText(/existing reports open without connecting a wallet or requesting payment/i),
    ).toBeTruthy()
  })

  it('does not promise a verified report when none exists', () => {
    const emptyLanding = render(<LandingState onLoadSample={vi.fn()} onInspect={vi.fn()} />)
    expect(emptyLanding.container.querySelector('.landing-proof')).toBeNull()
  })

  it('labels historical paid evidence as expired rather than sign-ready', () => {
    render(
      <EvidenceInspector
        report={{ ...currentClearReport, expiresAt: '2020-01-01T00:00:00.000Z' }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'HISTORICAL CLEAR · EXPIRED' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'CLEAR TO SIGN' })).toBeNull()
    expect(screen.getByText(/re-run a fresh inspection before signing anything/i)).toBeTruthy()
  })

  it('distinguishes loading and failed history from an empty workspace', () => {
    const onRetry = vi.fn()
    const { rerender } = render(
      <InspectionRail
        reports={[]}
        isLoading
        filter="ALL"
        onFilter={vi.fn()}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText('Loading inspections…')).toBeTruthy()
    rerender(
      <InspectionRail
        reports={[]}
        error="Network unavailable"
        filter="ALL"
        onFilter={vi.fn()}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText('History unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry history' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('does not imply evidence exists before an inspection runs', () => {
    render(<EvidenceInspector landing />)
    expect(screen.getByRole('heading', { name: 'AWAITING LIVE EVIDENCE' })).toBeTruthy()
    expect(screen.getByText(/no rule output exists yet/i)).toBeTruthy()
  })

  it('opens factual product documentation and closes it on request', () => {
    const onClose = vi.fn()
    render(<DocsDialog open onClose={onClose} />)

    expect(screen.getByRole('dialog', { name: 'How Celo Preflight works' })).toBeTruthy()
    expect(screen.getByText(/preflight does not submit your transaction/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close documentation' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('labels local inspection without implying a payment', () => {
    render(
      <TransactionForm
        value={transaction}
        capabilities={{
          localFree: true,
          hostedPaid: false,
          attribution: { configured: false },
          payment: { network: 'eip155:42220', unavailableReason: 'not configured' },
        }}
        status="idle"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onSample={vi.fn()}
        onReset={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /run local preflight/i })).toBeTruthy()
    expect(screen.queryByText('$0.01')).toBeNull()
  })

  it('keeps hosted inspection free until a separate claim is requested', () => {
    const { container } = render(
      <TransactionForm
        value={transaction}
        capabilities={{
          localFree: false,
          hostedPaid: true,
          attribution: { configured: true, requiredCode: 'celo_preflight_test' },
          payment: { network: 'eip155:42220', price: '$0.02' },
        }}
        status="idle"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onSample={vi.fn()}
        onReset={vi.fn()}
      />,
    )
    expect(within(container).getByRole('button', { name: /run preflight/i })).toBeTruthy()
    expect(within(container).queryByRole('button', { name: /claim signed report/i })).toBeNull()
    expect(within(container).getByText(/simulation is free/i)).toBeTruthy()
  })

  it('labels an unclaimed hosted result as an unsigned preview', () => {
    const { container } = render(<EvidenceInspector report={currentClearReport} />)
    expect(
      within(container).getByRole('heading', { name: 'PREVIEW CLEAR · UNCLAIMED' }),
    ).toBeTruthy()
    expect(within(container).getByText(/not a signed report/i)).toBeTruthy()
    expect(
      (
        within(container).getByRole('button', {
          name: 'Verify signature',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('renders a separate, explicit hosted claim action', () => {
    const { container } = render(
      <TransactionForm
        value={transaction}
        capabilities={{
          localFree: false,
          hostedPaid: true,
          attribution: { configured: true, requiredCode: 'celo_preflight_test' },
          payment: { network: 'eip155:42220', price: '$0.02' },
        }}
        status="awaiting-claim"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onClaim={vi.fn()}
        claimPrice="$0.02"
        onSample={vi.fn()}
        onReset={vi.fn()}
      />,
    )
    expect(
      within(container).getByRole('button', { name: 'Claim signed report · $0.02' }),
    ).toBeTruthy()
  })

  it('keeps the verdict and selected rule evidence linked', () => {
    const { container } = render(
      <EvidenceInspector report={report} selectedCheck={report.checks[0]} />,
    )
    expect(
      within(container).getByRole('heading', { name: 'PREVIEW BLOCK · UNCLAIMED' }),
    ).toBeTruthy()
    expect(within(container).getByText('execution reverted')).toBeTruthy()
    expect(
      within(container).getByText(/live evidence preview is not a signed report/i),
    ).toBeTruthy()
  })

  it('selects a deterministic check from the table', () => {
    const onSelect = vi.fn()
    render(<ChecksTable checks={report.checks} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('row', { name: /transaction simulation/i }))
    expect(onSelect).toHaveBeenCalledWith('SIMULATION')
  })
})

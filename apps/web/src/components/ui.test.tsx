import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PreparedReport, TransactionDraft } from '@preflight/shared'
import { ChecksTable } from './ChecksTable.js'
import { DocsDialog } from './DocsDialog.js'
import { EvidenceInspector } from './EvidenceInspector.js'
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
  expiresAt: '2026-07-17T00:10:00.000Z',
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

describe('Flight Deck controls', () => {
  it('makes the real sample and manual inspection paths explicit', () => {
    const onRunSample = vi.fn()
    const onInspect = vi.fn()
    render(<LandingState onRunSample={onRunSample} onInspect={onInspect} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run live sample' }))
    fireEvent.click(screen.getByRole('button', { name: 'Inspect your transaction' }))
    expect(onRunSample).toHaveBeenCalledOnce()
    expect(onInspect).toHaveBeenCalledOnce()
    expect(screen.getByText(/sample supplies unsigned input only/i)).toBeTruthy()
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

  it('renders the live hosted price rather than hard-coding one cent', () => {
    render(
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
    expect(screen.getByRole('button', { name: /run preflight · \$0.02/i })).toBeTruthy()
  })

  it('keeps the verdict and selected rule evidence linked', () => {
    render(<EvidenceInspector report={report} selectedCheck={report.checks[0]} />)
    expect(screen.getByRole('heading', { name: 'BLOCK' })).toBeTruthy()
    expect(screen.getByText('execution reverted')).toBeTruthy()
    expect(screen.getAllByText(/at least one deterministic safety rule failed/i)).toHaveLength(2)
  })

  it('selects a deterministic check from the table', () => {
    const onSelect = vi.fn()
    render(<ChecksTable checks={report.checks} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('row', { name: /transaction simulation/i }))
    expect(onSelect).toHaveBeenCalledWith('SIMULATION')
  })
})

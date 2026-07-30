import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Address, PreparedReport } from '@preflight/shared'
import { ReportStore } from './report-store.js'

const address = (digit: string) => `0x${digit.repeat(40)}` as Address

function report(id: string, options: { payer?: Address; bound?: boolean } = {}): PreparedReport {
  const payment = {
    network: 'eip155:42220',
    transactionHash: `0x${id.padEnd(64, '0')}` as `0x${string}`,
    payTo: address('8'),
    amount: '10000',
    asset: address('7'),
    settledAt: '2026-07-30T00:00:00.000Z',
    ...(options.payer ? { payer: options.payer } : {}),
  }
  return {
    id,
    requestHash: `0x${'1'.repeat(64)}`,
    rulesetVersion: 'celo-preflight/1.0.0',
    verdict: 'CLEAR',
    createdAt: '2026-07-30T00:00:00.000Z',
    expiresAt: '2026-07-30T00:10:00.000Z',
    issuer: address('9'),
    facts: {} as PreparedReport['facts'],
    checks: [],
    signature: `0x${'a'.repeat(130)}`,
    payment,
    ...(options.bound ? { paymentSignature: `0x${'b'.repeat(130)}` as `0x${string}` } : {}),
  }
}

describe('ReportStore payment metrics', () => {
  it('counts only issuer-bound receipts and deduplicates payer addresses', () => {
    const store = new ReportStore(mkdtempSync(join(tmpdir(), 'celo-preflight-store-')))
    store.save(report('one', { payer: address('1'), bound: true }))
    store.save(report('two', { payer: address('1').toUpperCase() as Address, bound: true }))
    store.save(report('three', { payer: address('2'), bound: false }))

    expect(store.paymentMetrics()).toEqual({ settledReports: 2, distinctPayers: 1 })
  })
})

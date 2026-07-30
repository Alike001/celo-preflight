import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import type { PreparedReport } from './types.js'
import { contentHash } from './canonical.js'
import {
  paymentReceiptSigningHash,
  reportSigningHash,
  verifyPreparedReport,
} from './report-verification.js'

const account = privateKeyToAccount(`0x${'1'.repeat(64)}`)
const address = (digit: string) => `0x${digit.repeat(40)}` as const

async function signedReport(): Promise<PreparedReport> {
  const report: PreparedReport = {
    id: '0x' as `0x${string}`,
    requestHash: `0x${'a'.repeat(64)}`,
    rulesetVersion: 'celo-preflight/1.0.0',
    verdict: 'CLEAR',
    createdAt: '2026-07-17T08:00:00.000Z',
    expiresAt: '2099-07-17T08:10:00.000Z',
    issuer: account.address,
    facts: {
      transaction: {
        chainId: 42220,
        from: address('1'),
        to: address('2'),
        valueWei: '0',
        data: '0x',
      },
      snapshot: { blockNumber: '1', observedAt: 1 },
      simulation: { status: 'success' },
      decoded: { kind: 'native-transfer', recipient: address('2'), amount: '0' },
      attributionCodes: [],
    },
    checks: [],
  }
  report.id = contentHash({
    requestHash: report.requestHash,
    rulesetVersion: report.rulesetVersion,
    blockNumber: report.facts.snapshot.blockNumber,
    issuer: report.issuer,
  })
  report.signature = await account.signMessage({ message: { raw: reportSigningHash(report) } })
  return report
}

describe('independent report verification', () => {
  it('recovers the report issuer without asking the issuing server', async () => {
    const verification = await verifyPreparedReport(await signedReport())
    expect(verification).toMatchObject({
      integrityValid: true,
      expired: false,
      recoveredIssuer: account.address,
    })
  })

  it('detects an altered report', async () => {
    const report = await signedReport()
    const verification = await verifyPreparedReport({ ...report, verdict: 'BLOCK' })
    expect(verification.integrityValid).toBe(false)
  })

  it('marks a legacy settlement receipt as unbound instead of pretending it is signed', async () => {
    const report = await signedReport()
    report.payment = {
      network: 'eip155:42220',
      transactionHash: `0x${'b'.repeat(64)}`,
      payTo: address('3'),
      amount: '10000',
      asset: address('4'),
      settledAt: '2026-07-17T08:01:00.000Z',
    }
    expect(await verifyPreparedReport(report)).toMatchObject({
      integrityValid: true,
      receiptIntegrityValid: false,
    })
  })

  it('verifies an independently signed settlement receipt and detects alteration', async () => {
    const report = await signedReport()
    report.payment = {
      network: 'eip155:42220',
      transactionHash: `0x${'b'.repeat(64)}`,
      payTo: address('3'),
      amount: '10000',
      asset: address('4'),
      settledAt: '2026-07-17T08:01:00.000Z',
    }
    report.paymentSignature = await account.signMessage({
      message: { raw: paymentReceiptSigningHash(report)! },
    })
    expect(await verifyPreparedReport(report)).toMatchObject({ receiptIntegrityValid: true })
    expect(
      await verifyPreparedReport({ ...report, payment: { ...report.payment, amount: '9999' } }),
    ).toMatchObject({ receiptIntegrityValid: false })
  })
})

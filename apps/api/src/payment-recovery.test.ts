import { encodeFunctionData, parseAbi } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type {
  Address,
  Hex,
  InspectionFacts,
  PaymentReceipt,
  PreparedReport,
} from '@preflight/shared'
import { recoverHistoricCeloClaim, reconcileEip3009Settlement } from './payment-layer.js'
import type { PaymentMetrics, ReportRepository } from './report-store.js'

const address = (digit: string) => `0x${digit.repeat(40)}` as Address
const payer = address('6')
const payTo = address('8')
const asset = address('5')
const transactionHash = `0x${'7'.repeat(64)}` as const
const transferWithAuthorizationAbi = parseAbi([
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
])
const payload = {
  authorization: { from: payer, to: payTo, value: '10000', nonce: `0x${'4'.repeat(64)}` as const },
}
const facts: InspectionFacts = {
  transaction: { chainId: 42220, from: address('1'), to: address('2'), valueWei: '1', data: '0x' },
  snapshot: { blockNumber: '123', observedAt: 1_700_000_000 },
  simulation: { status: 'success', gasEstimate: '21000' },
  decoded: { kind: 'native-transfer', recipient: address('2'), amount: '1' },
  attributionCodes: ['celo_preflight_test'],
}

class MemoryReports implements ReportRepository {
  readonly values = new Map<string, PreparedReport>()
  save(report: PreparedReport) {
    this.values.set(report.id, report)
  }
  get(id: string) {
    return this.values.get(id)
  }
  list(limit: number) {
    return [...this.values.values()].slice(0, limit)
  }
  hasPaymentTransaction(transactionHash: string) {
    return [...this.values.values()].some(
      (report) => report.payment?.transactionHash.toLowerCase() === transactionHash.toLowerCase(),
    )
  }
  attachPayment(id: string, receipt: PaymentReceipt) {
    const report = this.get(id)
    if (!report) return undefined
    const updated = { ...report, payment: receipt }
    this.save(updated)
    return updated
  }
  paymentMetrics(): PaymentMetrics {
    const reports = [...this.values.values()].filter(
      (report) => report.payment?.transactionHash && report.paymentSignature,
    )
    return {
      settledReports: reports.length,
      distinctPayers: new Set(
        reports.flatMap((report) =>
          report.payment?.payer ? [report.payment.payer.toLowerCase()] : [],
        ),
      ).size,
    }
  }
}

function authorizationInput() {
  return encodeFunctionData({
    abi: transferWithAuthorizationAbi,
    functionName: 'transferWithAuthorization',
    args: [
      payer,
      payTo,
      10_000n,
      0n,
      1_800_000_000n,
      payload.authorization.nonce,
      28,
      `0x${'1'.repeat(64)}`,
      `0x${'2'.repeat(64)}`,
    ],
  })
}

describe('lost x402 settlement recovery', () => {
  it('recovers only an executed authorization with an exact matching Transfer log', async () => {
    const client = {
      readContract: vi.fn(async () => true),
      getBlockNumber: vi.fn(async () => 1_000n),
      getLogs: vi.fn(async () => [
        { args: { value: 9_999n }, transactionHash: `0x${'3'.repeat(64)}` as Hex },
        { args: { value: 10_000n }, transactionHash },
      ]),
      getTransaction: vi.fn(async () => ({ to: asset, input: authorizationInput() })),
      getTransactionReceipt: vi.fn(),
      getBlock: vi.fn(),
    }
    await expect(
      reconcileEip3009Settlement(client, { payload, asset, payTo, amount: '10000' }),
    ).resolves.toEqual({ transactionHash, payer })
  })

  it('does not recover a nonce that the token has not marked used', async () => {
    const client = {
      readContract: vi.fn(async () => false),
      getBlockNumber: vi.fn(),
      getLogs: vi.fn(),
      getTransaction: vi.fn(),
      getTransactionReceipt: vi.fn(),
      getBlock: vi.fn(),
    }
    await expect(
      reconcileEip3009Settlement(client, { payload, asset, payTo, amount: '9999' }),
    ).resolves.toBeUndefined()
    expect(client.readContract).not.toHaveBeenCalled()
  })

  it('repairs a report only when its exact USDC authorization settled in its original window', async () => {
    const reports = new MemoryReports()
    reports.save({
      id: `0x${'a'.repeat(64)}`,
      requestHash: `0x${'b'.repeat(64)}`,
      rulesetVersion: 'celo-preflight/1.0.0',
      verdict: 'CLEAR',
      createdAt: '2023-11-14T22:13:00.000Z',
      expiresAt: '2023-11-14T22:23:00.000Z',
      issuer: address('9'),
      facts,
      checks: [],
    })
    const client = {
      readContract: vi.fn(),
      getBlockNumber: vi.fn(),
      getLogs: vi.fn(),
      getTransaction: vi.fn(async () => ({
        to: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C' as Address,
        input: authorizationInput(),
      })),
      getTransactionReceipt: vi.fn(async () => ({ status: 'success' as const, blockNumber: 100n })),
      getBlock: vi.fn(async () => ({ timestamp: 1_700_000_000n })),
    }
    const report = await recoverHistoricCeloClaim(client, reports, {
      reportId: `0x${'a'.repeat(64)}`,
      transactionHash,
      payTo,
      amount: '10000',
    })
    expect(report?.payment).toMatchObject({ transactionHash, payer, payTo, amount: '10000' })
  })
})

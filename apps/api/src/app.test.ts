import type { Express, RequestHandler } from 'express'
import request from 'supertest'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Address, InspectionFacts, PaymentReceipt, PreparedReport } from '@preflight/shared'
import type { ApiConfig } from './config.js'
import { HttpError } from './errors.js'
import { createApp } from './app.js'
import type { PaymentCapability } from './payment-layer.js'
import type { ReportRepository } from './report-store.js'

const address = (digit: string) => `0x${digit.repeat(40)}` as Address

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
  attachPayment(id: string, receipt: PaymentReceipt) {
    const report = this.get(id)
    if (!report) return undefined
    const updated = { ...report, payment: receipt }
    this.save(updated)
    return updated
  }
}

const config: ApiConfig = {
  port: 0,
  dataDir: '.data-test-unused',
  rpcUrls: { 42220: 'http://unused', 11142220: 'http://unused' },
  requiredAttributionCode: 'celo_preflight_test',
}

const payment: PaymentCapability = {
  enabled: false,
  network: 'eip155:42220',
  reason: 'Not configured for tests.',
}

const facts: InspectionFacts = {
  transaction: {
    chainId: 42220,
    from: address('1'),
    to: address('2'),
    valueWei: '1',
    data: '0x',
  },
  snapshot: { blockNumber: '123', observedAt: 1_700_000_000 },
  simulation: { status: 'success', gasEstimate: '21000' },
  decoded: { kind: 'native-transfer', recipient: address('2'), amount: '1' },
  attributionCodes: ['celo_preflight_test'],
}

describe('Celo Preflight API', () => {
  const reports = new MemoryReports()
  const inspector = { inspect: vi.fn(async () => facts) }
  const signer = {
    issuer: address('9'),
    sign: vi.fn(async () => `0x${'a'.repeat(130)}` as const),
  }
  let app: Express

  beforeAll(async () => {
    const runtime = await createApp(config, { reports, inspector, signer, payment })
    app = runtime.app
  })

  it('reports real runtime capability without advertising x402', async () => {
    const response = await request(app).get('/api/capabilities')
    expect(response.body).toMatchObject({
      localFree: true,
      hostedPaid: false,
      attribution: { configured: true, requiredCode: 'celo_preflight_test' },
      payment: { unavailableReason: 'Not configured for tests.' },
    })
  })

  it('publishes an agent-facing proposal contract without claiming it broadcasts', async () => {
    const response = await request(app).get('/api/openapi.json')
    expect(response.status).toBe(200)
    expect(response.body.paths).toHaveProperty('/api/preflight/prepare')
    expect(response.body.paths).toHaveProperty('/api/mento/live-usdm-kesm-proposal')
  })

  it('validates Mento proposal input before attempting a live route', async () => {
    const response = await request(app).post('/api/mento/live-usdm-kesm-proposal').send({})
    expect(response.status).toBe(400)
    expect(response.body.issues).toContain('owner must be a 20-byte hex address')
  })

  it('rejects an invalid transaction before inspection', async () => {
    const response = await request(app).post('/api/preflight/prepare').send({ chainId: 1 })
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ error: 'Invalid transaction draft' })
    expect(inspector.inspect).not.toHaveBeenCalled()
  })

  it('prepares, signs, stores, and retrieves a local-free report', async () => {
    const response = await request(app).post('/api/preflight/prepare').send(facts.transaction)
    expect(response.status).toBe(201)
    const body = response.body as { report: PreparedReport; claimRequired: boolean }
    expect(body.claimRequired).toBe(false)
    expect(body.report.verdict).toBe('CLEAR')
    expect(body.report.signature).toMatch(/^0x/)
    expect(body.report.facts.snapshot.blockNumber).toBe('123')

    const stored = await request(app).get(`/api/reports/${body.report.id}`)
    expect(stored.status).toBe(200)
    expect(stored.body).toMatchObject({ report: { id: body.report.id } })
  })

  it('lists report metadata without inventing transaction activity', async () => {
    const response = await request(app).get('/api/reports')
    const body = response.body as { reports: Array<Record<string, unknown>> }
    expect(body.reports).toHaveLength(1)
    expect(body.reports[0]).toMatchObject({ verdict: 'CLEAR', paid: false, chainId: 42220 })
    expect(body.reports[0]).not.toHaveProperty('facts')
  })

  it('keeps the paid claim endpoint unavailable when the capability gate is closed', async () => {
    const response = await request(app).post('/api/preflight/claim').send({ reportId: 'anything' })
    expect(response.status).toBe(503)
  })

  it('returns a factual 404 for unknown resources', async () => {
    expect((await request(app).get('/api/reports/missing')).status).toBe(404)
    expect((await request(app).get('/api/missing')).status).toBe(404)
  })
})

describe('RPC failure handling', () => {
  it('returns unavailable instead of fabricating a report', async () => {
    const inspector = {
      inspect: vi.fn(async () => {
        throw new HttpError(503, 'Celo RPC is unavailable.')
      }),
    }
    const runtime = await createApp(config, {
      reports: new MemoryReports(),
      inspector,
      signer: { issuer: address('9'), sign: vi.fn() },
      payment,
    })
    const response = await request(runtime.app)
      .post('/api/preflight/prepare')
      .send(facts.transaction)
    expect(response.status).toBe(503)
    expect(response.body).toEqual({ error: 'Celo RPC is unavailable.' })
  })
})

describe('hosted report access and claim preconditions', () => {
  const reports = new MemoryReports()
  const paymentGate = vi.fn()
  const middleware: RequestHandler = (request, response, next) => {
    const accepted = request.header('x-test-payment') === 'valid'
    paymentGate(accepted)
    if (!accepted) {
      response.status(402).json({ error: 'Payment required.' })
      return
    }
    next()
  }
  const hostedPayment: PaymentCapability = {
    enabled: true,
    network: 'eip155:42220',
    price: '$0.01',
    payTo: address('8'),
    middleware,
  }
  let app: Express
  let reportId: string

  beforeAll(async () => {
    const runtime = await createApp(config, {
      reports,
      inspector: { inspect: vi.fn(async () => facts) },
      signer: {
        issuer: address('9'),
        sign: vi.fn(async () => `0x${'a'.repeat(130)}` as const),
      },
      payment: hostedPayment,
    })
    app = runtime.app
    const prepared = await request(app).post('/api/preflight/prepare').send(facts.transaction)
    reportId = prepared.body.prepared.id as string
  })

  it('keeps a hosted report private before an x402 claim', async () => {
    const response = await request(app).get(`/api/reports/${reportId}`)
    expect(response.status).toBe(402)
    expect(response.body).toMatchObject({ claimEndpoint: '/api/preflight/claim' })
  })

  it('rejects missing, unknown, and invalid payment claims before disclosure', async () => {
    expect((await request(app).post('/api/preflight/claim').send({})).status).toBe(400)
    expect(
      (await request(app).post('/api/preflight/claim').send({ reportId: 'missing' })).status,
    ).toBe(404)
    expect((await request(app).post('/api/preflight/claim').send({ reportId })).status).toBe(402)
  })

  it('rejects an expired prepared report before the payment middleware', async () => {
    const prepared = reports.get(reportId)!
    reports.save({ ...prepared, id: 'expired', expiresAt: '2000-01-01T00:00:00.000Z' })
    const calls = paymentGate.mock.calls.length
    const response = await request(app).post('/api/preflight/claim').send({ reportId: 'expired' })
    expect(response.status).toBe(410)
    expect(paymentGate).toHaveBeenCalledTimes(calls)
  })

  it('returns a persisted paid report idempotently without charging again', async () => {
    reports.attachPayment(reportId, {
      network: 'eip155:42220',
      transactionHash: `0x${'7'.repeat(64)}`,
      payer: address('6'),
      payTo: address('8'),
      amount: '10000',
      asset: address('5'),
      settledAt: '2026-07-17T08:00:00.000Z',
    })
    const calls = paymentGate.mock.calls.length
    const retry = await request(app).post('/api/preflight/claim').send({ reportId })
    expect(retry.status).toBe(200)
    expect(retry.body.report.payment.transactionHash).toBe(`0x${'7'.repeat(64)}`)
    expect(paymentGate).toHaveBeenCalledTimes(calls)
    expect((await request(app).get(`/api/reports/${reportId}`)).status).toBe(200)
  })
})

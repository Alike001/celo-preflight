import type { Express, RequestHandler } from 'express'
import request from 'supertest'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Address, InspectionFacts, PreparedReport } from '@preflight/shared'
import type { ApiConfig } from './config.js'
import { HttpError } from './errors.js'
import { createApp } from './app.js'
import { createPaymentCapability, type PaymentCapability } from './payment-layer.js'
import { MemoryReports } from './test-support.js'

const address = (digit: string) => `0x${digit.repeat(40)}` as Address

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
    expect(response.body.paths).toHaveProperty('/api/impact')
  })

  it('publishes a factual agent integration guide', async () => {
    const response = await request(app).get('/api/agent.md')
    expect(response.status).toBe(200)
    expect(response.text).toContain('never broadcasts')
    expect(response.text).toContain('POST /api/preflight/prepare')
    expect(response.text).toContain('local-free mode')
  })

  it('serves an ERC-8004 registration document from the public well-known path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'celo-preflight-web-'))
    const previous = process.env.WEB_DIST_DIR
    try {
      await mkdir(join(directory, '.well-known'))
      await writeFile(join(directory, 'index.html'), '<!doctype html><title>Test shell</title>')
      await writeFile(
        join(directory, '.well-known', 'agent.json'),
        JSON.stringify({ name: 'Celo Preflight', services: [{ name: 'web' }] }),
      )
      process.env.WEB_DIST_DIR = directory
      const runtime = await createApp(config, {
        reports: new MemoryReports(),
        inspector,
        signer,
        payment,
      })

      const response = await request(runtime.app).get('/.well-known/agent.json')
      expect(response.status).toBe(200)
      expect(response.type).toMatch(/application\/json/)
      expect(response.body).toMatchObject({ name: 'Celo Preflight' })
    } finally {
      if (previous === undefined) delete process.env.WEB_DIST_DIR
      else process.env.WEB_DIST_DIR = previous
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('exposes only aggregate, issuer-bound payment evidence', async () => {
    const response = await request(app).get('/api/impact')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      metric: 'issuer-bound-x402-claims',
      settledReports: 0,
      distinctPayers: 0,
    })
    expect(JSON.stringify(response.body)).not.toContain(address('1'))
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

describe('Celo hosted facilitator credentials', () => {
  it('fails closed instead of advertising a paid endpoint without its API key', async () => {
    const capability = await createPaymentCapability(
      {
        facilitatorUrl: 'https://api.x402.celo.org',
        payTo: address('8'),
        price: '$0.01',
      },
      new MemoryReports(),
      'http://unused',
      async () => undefined,
    )
    expect(capability).toMatchObject({
      enabled: false,
      reason: 'Celo hosted facilitator requires X402_FACILITATOR_API_KEY for settlement.',
    })
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
    expect(prepared.body).toMatchObject({
      mode: 'hosted-paid',
      claimRequired: true,
      preview: { facts: { snapshot: { blockNumber: '123' } }, checks: expect.any(Array) },
    })
    expect(prepared.body.preview).not.toHaveProperty('signature')
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

  it('reserves exactly one payment-authorized claim until settlement is persisted', async () => {
    const prepared = reports.get(reportId)!
    reports.save({ ...prepared, id: 'race', expiresAt: '2099-01-01T00:00:00.000Z' })
    const calls = paymentGate.mock.calls.length
    const headers = { 'x-test-payment': 'valid', 'payment-signature': 'test-authorization' }
    const first = request(app).post('/api/preflight/claim').set(headers).send({ reportId: 'race' })
    const second = request(app).post('/api/preflight/claim').set(headers).send({ reportId: 'race' })
    const responses = await Promise.all([first, second])

    expect(
      responses.map((response) => response.status).sort((left, right) => left - right),
    ).toEqual([200, 409])
    expect(paymentGate).toHaveBeenCalledTimes(calls + 1)
  })

  it('releases an invalid authorization so a corrected authorization can retry', async () => {
    const prepared = reports.get(reportId)!
    reports.save({ ...prepared, id: 'retryable', expiresAt: '2099-01-01T00:00:00.000Z' })
    const invalid = await request(app)
      .post('/api/preflight/claim')
      .set('payment-signature', 'invalid-authorization')
      .send({ reportId: 'retryable' })
    expect(invalid.status).toBe(402)
    await new Promise<void>((resolve) => setImmediate(resolve))
    const corrected = await request(app)
      .post('/api/preflight/claim')
      .set({ 'x-test-payment': 'valid', 'payment-signature': 'corrected-authorization' })
      .send({ reportId: 'retryable' })
    expect(corrected.status).toBe(200)
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
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import express, { type ErrorRequestHandler } from 'express'
import { resolve } from 'node:path'
import { isAddress } from 'viem'
import type { Address, PrepareResponse } from '@preflight/shared'
import { parseTransactionDraft, ValidationError } from '@preflight/shared'
import { evaluateInspection } from '@preflight/engine'
import { ChainInspector } from './chain-inspector.js'
import type { ApiConfig } from './config.js'
import { HttpError } from './errors.js'
import { createPaymentCapability, type PaymentCapability } from './payment-layer.js'
import { claimPrecondition, claimedReport, releaseRejectedClaim } from './claim-guard.js'
import { ReportService } from './report-service.js'
import { ReportSigner } from './report-signer.js'
import { ReportStore, type ReportRepository } from './report-store.js'
import { createPrepareRateLimit } from './request-guard.js'
import { agentQuickstart, openApiDocument, reportSummary, webDistDirectory } from './app-helpers.js'

export interface AppOverrides {
  reports?: ReportRepository
  signer?: ConstructorParameters<typeof ReportService>[1]
  inspector?: ConstructorParameters<typeof ReportService>[0]
  payment?: PaymentCapability
}

export interface AppRuntime {
  app: express.Express
  payment: PaymentCapability
}

const UNCLAIMED_REPORT_RETENTION_MS = 24 * 60 * 60 * 1_000

export async function createApp(
  config: ApiConfig,
  overrides: AppOverrides = {},
): Promise<AppRuntime> {
  const reports: ReportRepository = overrides.reports ?? new ReportStore(config.dataDir)
  const signer =
    overrides.signer ?? (await ReportSigner.create(config.dataDir, config.reportSignerPrivateKey))
  const inspector = overrides.inspector ?? new ChainInspector(config)
  const mentoBuilder = inspector instanceof ChainInspector ? inspector : undefined
  const replayInspector = inspector instanceof ChainInspector ? inspector : undefined
  const service = new ReportService(inspector, signer, reports, config.requiredAttributionCode)
  const payment =
    overrides.payment ??
    (await createPaymentCapability(
      config.payment,
      reports,
      config.rpcUrls[42220],
      (reportId, receipt) => service.attachPaymentReceipt(reportId, receipt),
    ))
  const mode: PrepareResponse['mode'] = payment.enabled ? 'hosted-paid' : 'local-free'
  const app = express()
  const webDist = webDistDirectory()

  // Railway forwards one client-address hop. Local-free development keeps
  // Express's default direct-connection behavior.
  if (payment.enabled) app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(express.json({ limit: '64kb' }))
  if (webDist) app.use(express.static(webDist))
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', mode, ruleset: 'celo-preflight/1.0.0' })
  })

  app.get('/api/capabilities', (_request, response) => {
    response.json({
      localFree: !payment.enabled,
      hostedPaid: payment.enabled,
      attribution: {
        configured: Boolean(config.requiredAttributionCode),
        ...(config.requiredAttributionCode ? { requiredCode: config.requiredAttributionCode } : {}),
      },
      payment: {
        network: payment.network,
        ...(payment.price ? { price: payment.price } : {}),
        ...(payment.payTo ? { payTo: payment.payTo } : {}),
        ...(payment.reason ? { unavailableReason: payment.reason } : {}),
      },
    })
  })

  app.get('/api/openapi.json', (_request, response) => {
    response.json(openApiDocument())
  })

  app.get('/api/agent.md', (_request, response) => {
    response.type('text/markdown').send(agentQuickstart(payment))
  })

  const prepareRateLimit = payment.enabled ? createPrepareRateLimit() : undefined
  app.post(
    '/api/preflight/prepare',
    ...(prepareRateLimit ? [prepareRateLimit] : []),
    async (request, response) => {
      reports.pruneExpiredUnclaimed(
        new Date(Date.now() - UNCLAIMED_REPORT_RETENTION_MS).toISOString(),
      )
      const transaction = parseTransactionDraft(request.body)
      response.status(201).json(await service.prepare(transaction, mode))
    },
  )

  app.post('/api/mento/live-usdm-kesm-proposal', async (request, response) => {
    const owner = request.body?.owner
    const amountInWei = request.body?.amountInWei
    if (typeof owner !== 'string' || !isAddress(owner)) {
      throw new ValidationError(['owner must be a 20-byte hex address'])
    }
    if (typeof amountInWei !== 'string' || !/^\d+$/.test(amountInWei)) {
      throw new ValidationError(['amountInWei must be an integer string'])
    }
    if (!mentoBuilder) {
      throw new HttpError(503, 'Live Mento proposal building is unavailable in this API runtime.')
    }
    response.json(
      await mentoBuilder.buildLiveMentoProposal(
        owner as Address,
        BigInt(amountInWei),
        config.requiredAttributionCode,
      ),
    )
  })

  app.get('/api/reports', (request, response) => {
    const parsed = Number(request.query.limit ?? '30')
    const limit = Number.isFinite(parsed) ? parsed : 30
    response.json({ reports: reports.list(limit).map(reportSummary) })
  })

  app.get('/api/impact', (_request, response) => {
    response.json({
      metric: 'issuer-bound-x402-claims',
      ...reports.paymentMetrics(),
      notes: [
        'Counts only reports with a Celo x402 receipt separately signed by the report issuer.',
        'Distinct payer count excludes receipts that did not disclose a payer address.',
        'Counts are product evidence, not a claim of unique humans or leaderboard rank.',
      ],
    })
  })

  app.get('/api/reports/:id', (request, response) => {
    const report = reports.get(request.params.id)
    if (!report) {
      response.status(404).json({ error: 'Report not found.' })
      return
    }
    if (payment.enabled && !report.payment) {
      response.status(402).json({
        error: 'This hosted report must be claimed through x402.',
        claimEndpoint: '/api/preflight/claim',
      })
      return
    }
    response.json({ report })
  })

  app.post('/api/reports/:id/replay', async (request, response) => {
    const report = reports.get(request.params.id)
    if (!report) throw new HttpError(404, 'Report not found.')
    if (payment.enabled && !report.payment) {
      throw new HttpError(402, 'This hosted report must be claimed through x402.')
    }
    if (!replayInspector) {
      throw new HttpError(503, 'Exact-snapshot replay is unavailable in this API runtime.')
    }
    const facts = await replayInspector.inspectAtBlock(
      report.facts.transaction,
      BigInt(report.facts.snapshot.blockNumber),
      report.facts.snapshot.blockHash,
      BigInt(report.facts.snapshot.observedAt),
    )
    const evaluation = evaluateInspection(facts, {
      requiredAttributionCode: config.requiredAttributionCode,
    })
    response.json({
      reportId: report.id,
      facts,
      verdict: evaluation.verdict,
      checks: evaluation.checks,
    })
  })

  // Repair path for the exceptional case where Celo settled an x402
  // authorization but its facilitator lost the receipt. This never submits a
  // payment: it accepts only a mined, exact USDC authorization in the report's
  // original validity window.
  app.post('/api/preflight/recover', async (request, response) => {
    const { reportId, transactionHash } = request.body as {
      reportId?: unknown
      transactionHash?: unknown
    }
    if (typeof reportId !== 'string' || typeof transactionHash !== 'string') {
      throw new HttpError(400, 'reportId and transactionHash are required.')
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
      throw new HttpError(400, 'transactionHash must be a 32-byte transaction hash.')
    }
    if (!payment.recoverHistoricClaim) {
      throw new HttpError(503, 'Historic x402 recovery is unavailable in this runtime.')
    }
    const report = await payment.recoverHistoricClaim(reportId, transactionHash as `0x${string}`)
    if (!report) {
      throw new HttpError(
        422,
        'No matching settled Celo USDC authorization was found for this report.',
      )
    }
    response.json({ report, recovered: true })
  })

  if (payment.enabled && payment.middleware) {
    app.post(
      '/api/preflight/claim',
      claimPrecondition(reports),
      releaseRejectedClaim(reports, payment.middleware),
      (_request, response) => response.json({ report: claimedReport(response) }),
    )
  } else {
    app.post('/api/preflight/claim', (_request, response) => {
      response.status(503).json({
        error: 'Hosted x402 claim is unavailable.',
        reason: payment.reason,
      })
    })
  }

  app.get('{*path}', (request, response) => {
    if (request.path === '/api' || request.path.startsWith('/api/')) {
      response.status(404).json({ error: 'Not found.' })
      return
    }
    if (webDist) {
      response.sendFile(resolve(webDist, 'index.html'))
      return
    }
    response.status(404).json({ error: 'Not found.' })
  })

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof ValidationError) {
      response.status(400).json({ error: error.message, issues: error.issues })
      return
    }
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: error.message, details: error.details })
      return
    }
    console.error(error)
    response.status(500).json({ error: 'Internal server error.' })
  }
  app.use(errorHandler)

  return { app, payment }
}

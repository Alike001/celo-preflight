import express, { type ErrorRequestHandler } from 'express'
import type { PrepareResponse, PreparedReport } from '@preflight/shared'
import { parseTransactionDraft, ValidationError } from '@preflight/shared'
import { ChainInspector } from './chain-inspector.js'
import type { ApiConfig } from './config.js'
import { HttpError } from './errors.js'
import {
  claimPrecondition,
  createPaymentCapability,
  type PaymentCapability,
} from './payment-layer.js'
import { ReportService } from './report-service.js'
import { ReportSigner } from './report-signer.js'
import { ReportStore, type ReportRepository } from './report-store.js'

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

function summary(report: PreparedReport) {
  return {
    id: report.id,
    requestHash: report.requestHash,
    rulesetVersion: report.rulesetVersion,
    verdict: report.verdict,
    createdAt: report.createdAt,
    expiresAt: report.expiresAt,
    issuer: report.issuer,
    chainId: report.facts.transaction.chainId,
    to: report.facts.transaction.to,
    paid: Boolean(report.payment),
  }
}

export async function createApp(
  config: ApiConfig,
  overrides: AppOverrides = {},
): Promise<AppRuntime> {
  const reports: ReportRepository = overrides.reports ?? new ReportStore(config.dataDir)
  const signer =
    overrides.signer ?? (await ReportSigner.create(config.dataDir, config.reportSignerPrivateKey))
  const inspector = overrides.inspector ?? new ChainInspector(config)
  const service = new ReportService(inspector, signer, reports)
  const payment = overrides.payment ?? (await createPaymentCapability(config.payment, reports))
  const mode: PrepareResponse['mode'] = payment.enabled ? 'hosted-paid' : 'local-free'
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '64kb' }))
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
      payment: {
        network: payment.network,
        ...(payment.price ? { price: payment.price } : {}),
        ...(payment.payTo ? { payTo: payment.payTo } : {}),
        ...(payment.reason ? { unavailableReason: payment.reason } : {}),
      },
    })
  })

  app.post('/api/preflight/prepare', async (request, response) => {
    const transaction = parseTransactionDraft(request.body)
    response.status(201).json(await service.prepare(transaction, mode))
  })

  app.get('/api/reports', (request, response) => {
    const parsed = Number(request.query.limit ?? '30')
    const limit = Number.isFinite(parsed) ? parsed : 30
    response.json({ reports: reports.list(limit).map(summary) })
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

  if (payment.enabled && payment.middleware) {
    app.post(
      '/api/preflight/claim',
      claimPrecondition(reports),
      payment.middleware,
      (_request, response) => response.json({ report: response.locals.report as PreparedReport }),
    )
  } else {
    app.post('/api/preflight/claim', (_request, response) => {
      response.status(503).json({
        error: 'Hosted x402 claim is unavailable.',
        reason: payment.reason,
      })
    })
  }

  app.use((_request, response) => {
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

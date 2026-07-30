import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { paymentMiddleware } from '@x402/express'
import type { Address, Hex, PaymentReceipt, PreparedReport } from '@preflight/shared'
import { createChainClient } from './chain-client.js'
import type { ApiConfig } from './config.js'
import type { ReportRepository } from './report-store.js'
import {
  CELO_USDC,
  NETWORK,
  reconcileEip3009Settlement,
  recoverHistoricCeloClaim,
  type RecoveryClient,
} from './payment-recovery.js'
import { usdcExactPrice } from './payment-pricing.js'
import { paymentRejectionReason, settlementFailureDetails } from './payment-diagnostics.js'

export { reconcileEip3009Settlement, recoverHistoricCeloClaim } from './payment-recovery.js'
export { usdcExactPrice } from './payment-pricing.js'
export { paymentRejectionReason, settlementFailureDetails } from './payment-diagnostics.js'

export interface PaymentCapability {
  enabled: boolean
  network: typeof NETWORK
  price?: string
  payTo?: Address
  reason?: string
  middleware?: RequestHandler
  recoverHistoricClaim?: (
    reportId: string,
    transactionHash: Hex,
  ) => Promise<PreparedReport | undefined>
}

export type ReceiptAttester = (
  reportId: string,
  receipt: PaymentReceipt,
) => Promise<PreparedReport | undefined>

function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Facilitator capability check timed out')), milliseconds),
    ),
  ])
}

type HostedPaymentConfig = NonNullable<ApiConfig['payment']>

function usesCeloHostedFacilitator(config: HostedPaymentConfig) {
  return new URL(config.facilitatorUrl).hostname === 'api.x402.celo.org'
}

function facilitatorHeaders(config: HostedPaymentConfig) {
  return config.facilitatorApiKey ? { 'X-API-Key': config.facilitatorApiKey } : {}
}

function withPaymentDiagnostics(middleware: RequestHandler): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction) => {
    const paymentSignature = request.header('payment-signature') ?? request.header('x-payment')
    response.once('finish', () => {
      if (!paymentSignature || response.statusCode !== 402) return
      const header = response.getHeader('payment-required')
      const value = Array.isArray(header) ? header[0] : header
      const reason = typeof value === 'string' ? paymentRejectionReason(value) : undefined
      console.warn('x402 payment authorization rejected.', {
        reason: reason ?? 'The facilitator returned no structured reason.',
      })
    })
    middleware(request, response, next)
  }
}

function reportIdFromTransport(transportContext: unknown): string | undefined {
  if (!transportContext || typeof transportContext !== 'object') return undefined
  const body = (transportContext as { responseBody?: Buffer }).responseBody
  if (!body) return undefined
  try {
    return (JSON.parse(body.toString('utf8')) as { report?: PreparedReport }).report?.id
  } catch {
    return undefined
  }
}

function unsuccessfulSettlementDetails(result: {
  errorReason?: string
  errorMessage?: string
  network: string
}) {
  return {
    network: result.network,
    reason: result.errorReason ?? 'none',
    message: result.errorMessage ?? 'none',
  }
}

async function attachReceipt(
  attestReceipt: ReceiptAttester,
  reportId: string | undefined,
  receipt: PaymentReceipt,
) {
  if (!reportId) return undefined
  return attestReceipt(reportId, receipt)
}

export async function createPaymentCapability(
  config: ApiConfig['payment'],
  reports: ReportRepository,
  celoRpcUrl: string,
  attestReceipt: ReceiptAttester,
): Promise<PaymentCapability> {
  if (!config) {
    return { enabled: false, network: NETWORK, reason: 'Hosted payment is not configured.' }
  }
  if (usesCeloHostedFacilitator(config) && !config.facilitatorApiKey) {
    return {
      enabled: false,
      network: NETWORK,
      reason: 'Celo hosted facilitator requires X402_FACILITATOR_API_KEY for settlement.',
    }
  }
  const facilitator = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
    createAuthHeaders: async () => ({
      verify: facilitatorHeaders(config),
      settle: facilitatorHeaders(config),
      supported: facilitatorHeaders(config),
    }),
  })
  try {
    const supported = await timeout(facilitator.getSupported(), 4_000)
    const exactCelo = supported.kinds.some(
      (kind) => kind.x402Version === 2 && kind.scheme === 'exact' && kind.network === NETWORK,
    )
    if (!exactCelo) {
      return {
        enabled: false,
        network: NETWORK,
        reason: 'The configured facilitator does not advertise x402 v2 exact payments on Celo.',
      }
    }
  } catch (error) {
    return {
      enabled: false,
      network: NETWORK,
      reason: error instanceof Error ? error.message : 'Facilitator capability check failed.',
    }
  }

  const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme())
  const celoClient = createChainClient(42220, celoRpcUrl) as unknown as RecoveryClient
  resourceServer.onSettleFailure(
    async ({ error, paymentPayload, requirements, transportContext }) => {
      // A successful `/verify` can still be followed by a failed `/settle`.
      // Keep this log deliberately redacted: it identifies the facilitator
      // failure without writing a wallet authorization or payment payload.
      console.error('x402 facilitator settlement failed.', settlementFailureDetails(error))
      if (
        !usesCeloHostedFacilitator(config) ||
        requirements.network !== NETWORK ||
        requirements.asset.toLowerCase() !== CELO_USDC.toLowerCase()
      ) {
        return
      }
      const recovered = await reconcileEip3009Settlement(celoClient, {
        payload: paymentPayload.payload,
        asset: requirements.asset as Address,
        payTo: requirements.payTo as Address,
        amount: requirements.amount,
      })
      if (!recovered) return
      const receipt: PaymentReceipt = {
        network: NETWORK,
        transactionHash: recovered.transactionHash,
        payer: recovered.payer,
        payTo: requirements.payTo as Address,
        amount: requirements.amount,
        asset: requirements.asset as Address,
        settledAt: new Date().toISOString(),
      }
      const report = await attachReceipt(
        attestReceipt,
        reportIdFromTransport(transportContext),
        receipt,
      )
      if (!report) return
      console.warn('x402 settlement recovered from Celo chain state.', {
        transactionHash: recovered.transactionHash,
        reportId: report.id,
      })
      return {
        recovered: true,
        result: {
          success: true,
          transaction: recovered.transactionHash,
          network: NETWORK,
          payer: recovered.payer,
          amount: requirements.amount,
        },
      }
    },
  )
  resourceServer.onAfterSettle(async ({ result, requirements, transportContext }) => {
    try {
      if (!result.success) {
        console.error(
          'x402 facilitator settlement was declined.',
          unsuccessfulSettlementDetails(result),
        )
        return
      }
      const reportId = reportIdFromTransport(transportContext)
      if (!reportId || !/^0x[0-9a-fA-F]{64}$/.test(result.transaction)) return
      const receipt: PaymentReceipt = {
        network: result.network,
        transactionHash: result.transaction as Hex,
        ...(result.payer && /^0x[0-9a-fA-F]{40}$/.test(result.payer)
          ? { payer: result.payer as Address }
          : {}),
        payTo: requirements.payTo as Address,
        amount: result.amount ?? requirements.amount,
        asset: requirements.asset as Address,
        settledAt: new Date().toISOString(),
      }
      await attachReceipt(attestReceipt, reportId, receipt)
    } catch (error) {
      console.error('Payment settled but receipt persistence failed.', error)
    }
  })

  return {
    enabled: true,
    network: NETWORK,
    price: config.price,
    payTo: config.payTo,
    recoverHistoricClaim: async (reportId, transactionHash) => {
      const recovered = await recoverHistoricCeloClaim(celoClient, reports, {
        reportId,
        transactionHash,
        payTo: config.payTo,
        amount: usdcExactPrice(config.price).amount,
      })
      return recovered?.payment ? attestReceipt(reportId, recovered.payment) : recovered
    },
    middleware: withPaymentDiagnostics(
      paymentMiddleware(
        {
          'POST /api/preflight/claim': {
            accepts: [
              {
                scheme: 'exact',
                price: usdcExactPrice(config.price),
                network: NETWORK,
                payTo: config.payTo,
              },
            ],
            description: 'Claim a signed Celo Preflight report',
            mimeType: 'application/json',
          },
        },
        resourceServer,
      ),
    ),
  }
}

export function claimPrecondition(reports: ReportRepository): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const reportId = (request.body as { reportId?: unknown } | undefined)?.reportId
    if (typeof reportId !== 'string') {
      response.status(400).json({ error: 'reportId is required.' })
      return
    }
    const report = reports.get(reportId)
    if (!report) {
      response.status(404).json({ error: 'Prepared report not found.' })
      return
    }
    if (new Date(report.expiresAt).getTime() <= Date.now()) {
      response.status(410).json({ error: 'Prepared report expired. Run preflight again.' })
      return
    }
    if (report.payment) {
      response.json({ report })
      return
    }
    response.locals.report = report
    next()
  }
}

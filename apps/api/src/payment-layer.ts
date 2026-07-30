import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { decodePaymentRequiredHeader, decodePaymentSignatureHeader } from '@x402/core/http'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { paymentMiddleware } from '@x402/express'
import type { Address, Hex, PaymentReceipt, PreparedReport } from '@preflight/shared'
import type { ApiConfig } from './config.js'
import type { ReportRepository } from './report-store.js'

const NETWORK = 'eip155:42220'
const CELO_USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C'

export interface PaymentCapability {
  enabled: boolean
  network: typeof NETWORK
  price?: string
  payTo?: Address
  reason?: string
  middleware?: RequestHandler
}

function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Facilitator capability check timed out')), milliseconds),
    ),
  ])
}

export function usdcExactPrice(price: string) {
  const [, whole = '0', fraction = ''] = /^\$(\d+)(?:\.(\d+))?$/.exec(price) ?? []
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6))
  return {
    amount: amount.toString(),
    asset: CELO_USDC,
    // Celo's x402 facilitator verifies this EIP-712 domain exactly. Circle's
    // Celo contract uses "USDC" (not its display name "USD Coin").
    extra: { name: 'USDC', version: '2' },
  }
}

export function paymentRejectionReason(header: string | undefined): string | undefined {
  if (!header) return undefined
  try {
    const decoded = decodePaymentRequiredHeader(header)
    return typeof decoded.error === 'string' ? decoded.error : undefined
  } catch {
    return undefined
  }
}

type HostedPaymentConfig = NonNullable<ApiConfig['payment']>

function usesCeloHostedFacilitator(config: HostedPaymentConfig) {
  return new URL(config.facilitatorUrl).hostname === 'api.x402.celo.org'
}

function facilitatorHeaders(config: HostedPaymentConfig) {
  return config.facilitatorApiKey ? { 'X-API-Key': config.facilitatorApiKey } : {}
}

function paymentRequirements(config: HostedPaymentConfig) {
  return {
    scheme: 'exact',
    network: NETWORK,
    ...usdcExactPrice(config.price),
    payTo: config.payTo,
    maxTimeoutSeconds: 300,
  }
}

async function traceFacilitatorVerification(
  paymentSignature: string,
  config: HostedPaymentConfig,
) {
  try {
    const paymentPayload = decodePaymentSignatureHeader(paymentSignature)
    const response = await fetch(`${config.facilitatorUrl.replace(/\/+$/, '')}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...facilitatorHeaders(config) },
      body: JSON.stringify({
        x402Version: paymentPayload.x402Version,
        paymentPayload,
        paymentRequirements: paymentRequirements(config),
      }),
    })
    const body = (await response.json().catch(() => ({}))) as {
      isValid?: unknown
      invalidReason?: unknown
      invalidReasonDetails?: unknown
    }
    console.warn('x402 facilitator raw verification result.', {
      status: response.status,
      isValid: body.isValid === true,
      invalidReason: typeof body.invalidReason === 'string' ? body.invalidReason : 'none',
      invalidReasonDetails:
        typeof body.invalidReasonDetails === 'string' ? body.invalidReasonDetails : 'none',
    })
  } catch (error) {
    console.warn('x402 facilitator raw verification request failed.', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

function withPaymentDiagnostics(
  middleware: RequestHandler,
  config: HostedPaymentConfig,
): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction) => {
    const paymentSignature = request.header('payment-signature') ?? request.header('x-payment')
    if (paymentSignature) await traceFacilitatorVerification(paymentSignature, config)
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

function settlementFailureDetails(error: unknown) {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined
  return {
    name: error instanceof Error ? error.name : 'Unknown error',
    message: error instanceof Error ? error.message : 'Unknown error',
    ...(typeof value?.status === 'number' ? { status: value.status } : {}),
    ...(typeof value?.statusCode === 'number' ? { statusCode: value.statusCode } : {}),
    ...(typeof value?.code === 'string' ? { code: value.code } : {}),
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

export async function createPaymentCapability(
  config: ApiConfig['payment'],
  reports: ReportRepository,
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
  resourceServer.onSettleFailure(async ({ error }) => {
    // A successful `/verify` can still be followed by a failed `/settle`.
    // Keep this log deliberately redacted: it identifies the facilitator
    // failure without writing a wallet authorization or payment payload.
    console.error('x402 facilitator settlement failed.', settlementFailureDetails(error))
  })
  resourceServer.onAfterSettle(async ({ result, requirements, transportContext }) => {
    try {
      if (!result.success) {
        console.error('x402 facilitator settlement was declined.', unsuccessfulSettlementDetails(result))
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
      reports.attachPayment(reportId, receipt)
    } catch (error) {
      console.error('Payment settled but receipt persistence failed.', error)
    }
  })

  return {
    enabled: true,
    network: NETWORK,
    price: config.price,
    payTo: config.payTo,
    middleware: withPaymentDiagnostics(paymentMiddleware(
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
    ), config),
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

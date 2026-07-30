import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { decodePaymentRequiredHeader } from '@x402/core/http'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { paymentMiddleware } from '@x402/express'
import { decodeFunctionData, parseAbi, parseAbiItem } from 'viem'
import type { Address, Hex, PaymentReceipt, PreparedReport } from '@preflight/shared'
import { createChainClient } from './chain-client.js'
import type { ApiConfig } from './config.js'
import type { ReportRepository } from './report-store.js'

const NETWORK = 'eip155:42220'
const CELO_USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C'
const eip3009Abi = parseAbi([
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
])
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

export interface PaymentCapability {
  enabled: boolean
  network: typeof NETWORK
  price?: string
  payTo?: Address
  reason?: string
  middleware?: RequestHandler
  recoverHistoricClaim?: (reportId: string, transactionHash: Hex) => Promise<PreparedReport | undefined>
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

interface Eip3009Authorization {
  from: Address
  to: Address
  value: string
  nonce: Hex
}

interface RecoveryClient {
  readContract(args: unknown): Promise<unknown>
  getBlockNumber(): Promise<bigint>
  getLogs(args: unknown): Promise<Array<{ args?: { value?: bigint }; transactionHash?: Hex }>>
  getTransaction(args: unknown): Promise<{ input: Hex; to?: Address; blockNumber?: bigint | null }>
  getTransactionReceipt(args: unknown): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint }>
  getBlock(args: unknown): Promise<{ timestamp: bigint }>
}

function usesCeloHostedFacilitator(config: HostedPaymentConfig) {
  return new URL(config.facilitatorUrl).hostname === 'api.x402.celo.org'
}

function facilitatorHeaders(config: HostedPaymentConfig) {
  return config.facilitatorApiKey ? { 'X-API-Key': config.facilitatorApiKey } : {}
}

function eip3009Authorization(payload: unknown): Eip3009Authorization | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const authorization = (payload as { authorization?: unknown }).authorization
  if (!authorization || typeof authorization !== 'object') return undefined
  const value = authorization as Record<string, unknown>
  if (
    typeof value.from !== 'string' ||
    typeof value.to !== 'string' ||
    typeof value.value !== 'string' ||
    typeof value.nonce !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(value.from) ||
    !/^0x[0-9a-fA-F]{40}$/.test(value.to) ||
    !/^\d+$/.test(value.value) ||
    !/^0x[0-9a-fA-F]{64}$/.test(value.nonce)
  ) {
    return undefined
  }
  return {
    from: value.from as Address,
    to: value.to as Address,
    value: value.value,
    nonce: value.nonce as Hex,
  }
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

export async function reconcileEip3009Settlement(
  client: RecoveryClient,
  input: {
    payload: unknown
    asset: Address
    payTo: Address
    amount: string
  },
): Promise<{ transactionHash: Hex; payer: Address } | undefined> {
  const authorization = eip3009Authorization(input.payload)
  if (
    !authorization ||
    authorization.to.toLowerCase() !== input.payTo.toLowerCase() ||
    authorization.value !== input.amount
  ) {
    return undefined
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const used = await client.readContract({
        address: input.asset,
        abi: eip3009Abi,
        functionName: 'authorizationState',
        args: [authorization.from, authorization.nonce],
      })
      if (used === true) {
        const latestBlock = await client.getBlockNumber()
        // Celo can confirm the transfer before a facilitator returns its receipt.
        // Search a ten-minute window, safely below the public RPC log-range limit.
        const fromBlock = latestBlock > 600n ? latestBlock - 600n : 0n
        const transfers = await client.getLogs({
          address: input.asset,
          event: transferEvent,
          args: { from: authorization.from, to: authorization.to },
          fromBlock,
          toBlock: latestBlock,
        })
        for (const transfer of transfers) {
          if (transfer.args?.value?.toString() !== authorization.value || !transfer.transactionHash) continue
          const transaction = await client.getTransaction({ hash: transfer.transactionHash })
          if (transaction.to?.toLowerCase() !== input.asset.toLowerCase()) continue
          const decoded = decodeFunctionData({ abi: eip3009Abi, data: transaction.input })
          if (
            decoded.functionName === 'transferWithAuthorization' &&
            decoded.args[0]?.toLowerCase() === authorization.from.toLowerCase() &&
            decoded.args[1]?.toLowerCase() === authorization.to.toLowerCase() &&
            decoded.args[2]?.toString() === authorization.value &&
            decoded.args[5]?.toLowerCase() === authorization.nonce.toLowerCase()
          ) {
            return { transactionHash: transfer.transactionHash, payer: authorization.from }
          }
        }
      }
    } catch {
      // A reconciliation failure must never turn an unknown settlement into success.
    }
    if (attempt < 5) await wait(1_000)
  }
  return undefined
}

export async function recoverHistoricCeloClaim(
  client: RecoveryClient,
  reports: ReportRepository,
  input: { reportId: string; transactionHash: Hex; payTo: Address; amount: string },
): Promise<PreparedReport | undefined> {
  const report = reports.get(input.reportId)
  if (!report || report.payment || reports.hasPaymentTransaction(input.transactionHash)) return undefined
  try {
    const [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash: input.transactionHash }),
      client.getTransactionReceipt({ hash: input.transactionHash }),
    ])
    if (receipt.status !== 'success' || transaction.to?.toLowerCase() !== CELO_USDC.toLowerCase()) {
      return undefined
    }
    const decoded = decodeFunctionData({ abi: eip3009Abi, data: transaction.input })
    if (
      decoded.functionName !== 'transferWithAuthorization' ||
      decoded.args[1]?.toLowerCase() !== input.payTo.toLowerCase() ||
      decoded.args[2]?.toString() !== input.amount
    ) {
      return undefined
    }
    const block = await client.getBlock({ blockNumber: receipt.blockNumber })
    const settledAt = new Date(Number(block.timestamp) * 1_000)
    if (
      settledAt.getTime() < new Date(report.createdAt).getTime() ||
      settledAt.getTime() > new Date(report.expiresAt).getTime()
    ) {
      return undefined
    }
    return reports.attachPayment(report.id, {
      network: NETWORK,
      transactionHash: input.transactionHash,
      payer: decoded.args[0] as Address,
      payTo: input.payTo,
      amount: input.amount,
      asset: CELO_USDC,
      settledAt: settledAt.toISOString(),
    })
  } catch {
    // A historic repair must be just as strict as a live claim: absent proof means no receipt.
    return undefined
  }
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

function attachReceipt(
  reports: ReportRepository,
  reportId: string | undefined,
  receipt: PaymentReceipt,
) {
  if (!reportId) return undefined
  return reports.attachPayment(reportId, receipt)
}

export async function createPaymentCapability(
  config: ApiConfig['payment'],
  reports: ReportRepository,
  celoRpcUrl: string,
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
  resourceServer.onSettleFailure(async ({ error, paymentPayload, requirements, transportContext }) => {
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
    const report = attachReceipt(reports, reportIdFromTransport(transportContext), receipt)
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
      attachReceipt(reports, reportId, receipt)
    } catch (error) {
      console.error('Payment settled but receipt persistence failed.', error)
    }
  })

  return {
    enabled: true,
    network: NETWORK,
    price: config.price,
    payTo: config.payTo,
    recoverHistoricClaim: (reportId, transactionHash) =>
      recoverHistoricCeloClaim(celoClient, reports, {
        reportId,
        transactionHash,
        payTo: config.payTo,
        amount: usdcExactPrice(config.price).amount,
      }),
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
    )),
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

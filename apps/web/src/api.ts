import type { PrepareResponse, PreparedReport, TransactionDraft, Verdict } from '@preflight/shared'

export interface ReportSummary {
  id: string
  requestHash: `0x${string}`
  rulesetVersion: string
  verdict: Verdict
  createdAt: string
  expiresAt: string
  issuer: `0x${string}`
  chainId: number
  to: `0x${string}`
  paid: boolean
}

export interface Capabilities {
  localFree: boolean
  hostedPaid: boolean
  attribution: {
    configured: boolean
    requiredCode?: string
  }
  payment: {
    network: string
    price?: string
    payTo?: `0x${string}`
    unavailableReason?: string
  }
}

export interface MentoProposal {
  transaction: TransactionDraft
  approvalRequired: boolean
  quote: {
    amountIn: string
    expectedAmountOut: string
    minimumAmountOut: string
    deadline: string
    hops: number
    tradable: boolean
  }
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string; issues?: string[] }
  if (!response.ok) {
    const details = body.issues?.join(' ') ?? ''
    throw new Error(`${body.error ?? `Request failed (${response.status})`} ${details}`.trim())
  }
  return body
}

export async function getCapabilities(): Promise<Capabilities> {
  return json(await fetch('/api/capabilities'))
}

export async function getHistory(): Promise<ReportSummary[]> {
  const body = await json<{ reports: ReportSummary[] }>(await fetch('/api/reports'))
  return body.reports
}

export async function getReport(id: string): Promise<PreparedReport> {
  const body = await json<{ report: PreparedReport }>(await fetch(`/api/reports/${id}`))
  return body.report
}

export async function prepareReport(transaction: TransactionDraft): Promise<PrepareResponse> {
  return json(
    await fetch('/api/preflight/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(transaction),
    }),
  )
}

export async function getLiveMentoProposal(owner: `0x${string}`): Promise<MentoProposal> {
  return json(
    await fetch('/api/mento/live-usdm-kesm-proposal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner, amountInWei: '10000000000000000' }),
    }),
  )
}

import type { Account, PublicClient, WalletClient } from 'viem'
import type { PreparedReport } from '@preflight/shared'
import { toClientEvmSigner } from '@x402/evm'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { wrapFetchWithPayment, x402Client } from '@x402/fetch'

export function paymentError(response: Response, body?: { error?: string }) {
  if (body?.error) return body.error
  const required = response.headers.get('payment-required')
  if (required) {
    try {
      const normalized = required.replace(/-/g, '+').replace(/_/g, '/')
      const decoded = JSON.parse(atob(normalized)) as { error?: unknown }
      if (typeof decoded.error === 'string' && decoded.error) return decoded.error
    } catch {
      // Keep the HTTP status as the factual fallback when a malformed header is returned.
    }
  }
  return `Payment failed (${response.status})`
}

export async function claimReportWithX402(
  reportId: string,
  walletClient: WalletClient,
  publicClient: PublicClient,
): Promise<PreparedReport> {
  if (!walletClient.account) throw new Error('Connect a wallet before claiming the report.')
  const signer = toClientEvmSigner(
    {
      address: walletClient.account.address,
      signTypedData: async (message) =>
        walletClient.signTypedData({
          account: walletClient.account as Account,
          domain: message.domain,
          types: message.types,
          primaryType: message.primaryType,
          message: message.message,
        }),
    },
    {
      readContract: (args) => publicClient.readContract(args),
    },
  )
  const client = new x402Client().register('eip155:*', new ExactEvmScheme(signer))
  const paidFetch = wrapFetchWithPayment(fetch, client)
  const response = await paidFetch('/api/preflight/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reportId }),
  })
  const body = (await response.json()) as { report?: PreparedReport; error?: string }
  if (!response.ok || !body.report) {
    throw new Error(paymentError(response, body))
  }

  // Settlement hooks persist the receipt after the claim handler has built its
  // response. Read the stored report once so the UI always shows the receipt
  // that the server actually recorded, including an on-chain reconciliation.
  const stored = await fetch(`/api/reports/${reportId}`)
  if (stored.ok) {
    const persisted = (await stored.json()) as { report?: PreparedReport }
    if (persisted.report) return persisted.report
  }
  return body.report
}

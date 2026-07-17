import type { Account, PublicClient, WalletClient } from 'viem'
import type { PreparedReport } from '@preflight/shared'
import { toClientEvmSigner } from '@x402/evm'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { wrapFetchWithPayment, x402Client } from '@x402/fetch'

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
    throw new Error(body.error ?? `Payment failed (${response.status})`)
  }
  return body.report
}

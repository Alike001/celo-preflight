import { parseAbi } from 'viem'
import type { Address, TransactionDraft } from '@preflight/shared'
import { FEE_CURRENCY_DIRECTORIES } from '@preflight/engine'
import type { CeloPublicClient } from './chain-client.js'

const feeCurrencyDirectoryAbi = parseAbi(['function getCurrencies() view returns (address[])'])

/** Reads Celo's governed allowlist at the exact inspection snapshot block. */
export async function feeCurrencyAllowed(
  client: CeloPublicClient,
  chainId: TransactionDraft['chainId'],
  feeCurrency: Address | undefined,
  blockNumber: bigint,
): Promise<boolean | undefined> {
  if (!feeCurrency) return undefined
  try {
    const currencies = await client.readContract({
      address: FEE_CURRENCY_DIRECTORIES[chainId],
      abi: feeCurrencyDirectoryAbi,
      functionName: 'getCurrencies',
      blockNumber,
    })
    return currencies.some((currency) => currency.toLowerCase() === feeCurrency.toLowerCase())
  } catch {
    return undefined
  }
}

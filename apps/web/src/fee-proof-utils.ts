import { getAddress, isAddress, parseUnits } from 'viem'

export const CELO_SEPOLIA_CHAIN_ID = 11142220
export const CELO_SEPOLIA_USDC = '0x01C5C0122039549AD1493B8220cABEdD739BC44E' as const
export const FEE_CURRENCY_DIRECTORY = '0x9212Fb72ae65367A7c887eC4Ad9bE310BAC611BF' as const
const NORMALIZED_TO_USDC = 10n ** 12n

export type ListedFeeCurrency = {
  address: `0x${string}`
  adaptedToken?: `0x${string}`
}

export function parseUsdcAmount(value: string, field: string): bigint {
  try {
    const amount = parseUnits(value.trim(), 6)
    if (amount <= 0n) throw new Error('not positive')
    return amount
  } catch {
    throw new Error(`${field} must be a positive USDC amount with at most 6 decimal places.`)
  }
}

export function parseRecipient(value: string): `0x${string}` {
  if (!isAddress(value.trim())) throw new Error('Recipient must be a valid 20-byte address.')
  return getAddress(value.trim())
}

export function findLiveUsdcFeeCurrency(currencies: ListedFeeCurrency[]) {
  return currencies.find(
    (currency) => currency.adaptedToken?.toLowerCase() === CELO_SEPOLIA_USDC.toLowerCase(),
  )
}

export function normalizedFeeToUsdcBaseUnits(normalizedFee: bigint) {
  return (normalizedFee + NORMALIZED_TO_USDC - 1n) / NORMALIZED_TO_USDC
}

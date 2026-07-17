import type { Address, Hex, SupportedChainId, TransactionDraft } from './types.js'

const addressPattern = /^0x[0-9a-fA-F]{40}$/
const hexPattern = /^0x(?:[0-9a-fA-F]{2})*$/

export class ValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super('Invalid transaction draft')
    this.name = 'ValidationError'
    this.issues = issues
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAddress(value: unknown): value is Address {
  return typeof value === 'string' && addressPattern.test(value)
}

export function isHex(value: unknown): value is Hex {
  return typeof value === 'string' && hexPattern.test(value)
}

export function parseTransactionDraft(value: unknown): TransactionDraft {
  if (!isRecord(value)) throw new ValidationError(['body must be a JSON object'])

  const issues: string[] = []
  const chainId = value.chainId
  const from = value.from
  const to = value.to
  const valueWei = value.valueWei
  const data = value.data
  const feeCurrency = value.feeCurrency

  if (chainId !== 42220 && chainId !== 11142220) {
    issues.push('chainId must be Celo (42220) or Celo Sepolia (11142220)')
  }
  if (!isAddress(from)) issues.push('from must be a 20-byte hex address')
  if (!isAddress(to)) issues.push('to must be a 20-byte hex address')
  if (typeof valueWei !== 'string' || !/^\d+$/.test(valueWei)) {
    issues.push('valueWei must be a non-negative base-10 integer string')
  }
  if (!isHex(data)) issues.push('data must be even-length hex prefixed by 0x')
  if (feeCurrency !== undefined && !isAddress(feeCurrency)) {
    issues.push('feeCurrency must be a 20-byte hex address when provided')
  }
  if (issues.length > 0) throw new ValidationError(issues)

  return {
    chainId: chainId as SupportedChainId,
    from: from as Address,
    to: to as Address,
    valueWei: valueWei as string,
    data: data as Hex,
    ...(feeCurrency === undefined ? {} : { feeCurrency: feeCurrency as Address }),
  }
}

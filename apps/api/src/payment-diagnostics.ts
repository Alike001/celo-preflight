import { decodePaymentRequiredHeader } from '@x402/core/http'

export function paymentRejectionReason(header: string | undefined): string | undefined {
  if (!header) return undefined
  try {
    const decoded = decodePaymentRequiredHeader(header)
    return typeof decoded.error === 'string' ? decoded.error : undefined
  } catch {
    return undefined
  }
}

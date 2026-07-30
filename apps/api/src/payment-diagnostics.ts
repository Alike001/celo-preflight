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

export function settlementFailureDetails(error: unknown) {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined
  return {
    name: error instanceof Error ? error.name : 'Unknown error',
    message: error instanceof Error ? error.message : 'Unknown error',
    ...(typeof value?.status === 'number' ? { status: value.status } : {}),
    ...(typeof value?.statusCode === 'number' ? { statusCode: value.statusCode } : {}),
    ...(typeof value?.code === 'string' ? { code: value.code } : {}),
  }
}

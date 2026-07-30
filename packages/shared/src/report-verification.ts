import { getAddress, recoverMessageAddress } from 'viem'
import type { Address, PreparedReport } from './types.js'
import { contentHash } from './canonical.js'

export interface ReportVerification {
  integrityValid: boolean
  receiptIntegrityValid?: boolean
  expired: boolean
  recoveredIssuer?: Address
  reportHash?: `0x${string}`
  reasons: string[]
}

/** Fields that were present when Celo Preflight signed the report. */
export function unsignedReport(
  report: PreparedReport,
): Omit<PreparedReport, 'signature' | 'payment' | 'paymentSignature'> {
  const {
    signature: _signature,
    payment: _payment,
    paymentSignature: _paymentSignature,
    ...unsigned
  } = report
  return unsigned
}

export function reportSigningHash(report: PreparedReport): `0x${string}` {
  return contentHash(unsignedReport(report))
}

/** The report signature covers inspection evidence; this covers a later x402 receipt. */
export function paymentReceiptSigningHash(report: PreparedReport): `0x${string}` | undefined {
  if (!report.payment || !report.signature) return undefined
  return contentHash({
    reportId: report.id,
    reportSignature: report.signature,
    payment: report.payment,
  })
}

function sameAddress(left: Address, right: Address): boolean {
  return getAddress(left) === getAddress(right)
}

export async function verifyPreparedReport(report: PreparedReport): Promise<ReportVerification> {
  const reasons: string[] = []
  const expectedId = contentHash({
    requestHash: report.requestHash,
    rulesetVersion: report.rulesetVersion,
    blockNumber: report.facts.snapshot.blockNumber,
    issuer: report.issuer,
  })
  if (report.id !== expectedId) reasons.push('Report ID does not match its signed identity fields.')

  const expired =
    Number.isNaN(Date.parse(report.expiresAt)) || Date.parse(report.expiresAt) <= Date.now()
  if (expired) reasons.push('Report has expired; its snapshot is no longer current.')

  if (!report.signature) {
    reasons.push('Report has no ECDSA signature.')
    return { integrityValid: false, expired, reasons }
  }

  const reportHash = reportSigningHash(report)
  try {
    const recoveredIssuer = await recoverMessageAddress({
      message: { raw: reportHash },
      signature: report.signature,
    })
    if (!sameAddress(recoveredIssuer, report.issuer)) {
      reasons.push('ECDSA signature was not made by the declared issuer.')
    }
    let receiptIntegrityValid: boolean | undefined
    if (report.payment) {
      const paymentHash = paymentReceiptSigningHash(report)
      if (!report.paymentSignature || !paymentHash) {
        receiptIntegrityValid = false
        reasons.push('Settlement receipt is not bound by an issuer signature.')
      } else {
        try {
          const receiptIssuer = await recoverMessageAddress({
            message: { raw: paymentHash },
            signature: report.paymentSignature,
          })
          receiptIntegrityValid = sameAddress(receiptIssuer, report.issuer)
          if (!receiptIntegrityValid) {
            reasons.push('Settlement receipt signature was not made by the declared issuer.')
          }
        } catch {
          receiptIntegrityValid = false
          reasons.push('Settlement receipt signature could not be recovered.')
        }
      }
    }
    return {
      integrityValid: reasons.every(
        (reason) => !reason.includes('does not match') && !reason.includes('not made'),
      ),
      ...(receiptIntegrityValid === undefined ? {} : { receiptIntegrityValid }),
      expired,
      recoveredIssuer,
      reportHash,
      reasons,
    }
  } catch {
    reasons.push('ECDSA signature could not be recovered from this report.')
    return { integrityValid: false, expired, reportHash, reasons }
  }
}

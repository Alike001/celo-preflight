import type { ClaimReservation, PaymentMetrics, ReportRepository } from './report-store.js'
import type { PaymentReceipt, PreparedReport } from '@preflight/shared'

/** In-memory repository for API tests; production always uses ReportStore. */
export class MemoryReports implements ReportRepository {
  readonly values = new Map<string, PreparedReport>()
  readonly reserved = new Map<string, number>()

  save(report: PreparedReport) {
    this.values.set(report.id, report)
  }

  get(id: string) {
    return this.values.get(id)
  }

  list(limit: number) {
    return [...this.values.values()].slice(0, limit)
  }

  hasPaymentTransaction(transactionHash: string) {
    return [...this.values.values()].some(
      (report) => report.payment?.transactionHash.toLowerCase() === transactionHash.toLowerCase(),
    )
  }

  reserveClaim(id: string, now: number, staleAfterMs: number): ClaimReservation {
    const report = this.get(id)
    if (!report) return 'not-found'
    if (report.payment) return 'already-settled'
    const reservedAt = this.reserved.get(id)
    if (reservedAt !== undefined && reservedAt > now - staleAfterMs) return 'in-progress'
    this.reserved.set(id, now)
    return 'reserved'
  }

  releaseClaim(id: string) {
    this.reserved.delete(id)
  }

  attachPayment(id: string, receipt: PaymentReceipt) {
    const report = this.get(id)
    if (!report) return undefined
    const updated = { ...report, payment: receipt }
    this.save(updated)
    this.releaseClaim(id)
    return updated
  }

  pruneExpiredUnclaimed(before: string) {
    let removed = 0
    for (const [id, report] of this.values) {
      if (report.expiresAt < before && !report.payment) {
        this.values.delete(id)
        this.releaseClaim(id)
        removed += 1
      }
    }
    return removed
  }

  paymentMetrics(): PaymentMetrics {
    const reports = [...this.values.values()].filter(
      (report) => report.payment?.transactionHash && report.paymentSignature,
    )
    return {
      settledReports: reports.length,
      distinctPayers: new Set(
        reports.flatMap((report) =>
          report.payment?.payer ? [report.payment.payer.toLowerCase()] : [],
        ),
      ).size,
    }
  }
}

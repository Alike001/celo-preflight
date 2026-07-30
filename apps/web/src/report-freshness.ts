import type { PreparedReport } from '@preflight/shared'
import type { ReportSummary } from './api.js'

type ExpiringReport = Pick<PreparedReport | ReportSummary, 'expiresAt'>

export function isReportExpired(report: ExpiringReport, now = Date.now()) {
  const expiresAt = Date.parse(report.expiresAt)
  return !Number.isFinite(expiresAt) || expiresAt <= now
}

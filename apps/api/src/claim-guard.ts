import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { PreparedReport } from '@preflight/shared'
import type { ReportRepository } from './report-store.js'

const CLAIM_RESERVATION_TTL_MS = 15 * 60 * 1_000

/**
 * Challenges remain free; a durable reservation begins only when a payer
 * supplies an x402 authorization. This prevents parallel paid retries from
 * charging the same report twice.
 */
export function claimPrecondition(reports: ReportRepository): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const reportId = (request.body as { reportId?: unknown } | undefined)?.reportId
    if (typeof reportId !== 'string') {
      response.status(400).json({ error: 'reportId is required.' })
      return
    }
    const report = reports.get(reportId)
    if (!report) {
      response.status(404).json({ error: 'Prepared report not found.' })
      return
    }
    if (new Date(report.expiresAt).getTime() <= Date.now()) {
      response.status(410).json({ error: 'Prepared report expired. Run preflight again.' })
      return
    }
    if (report.payment) {
      response.json({ report })
      return
    }

    const paymentAuthorization = request.header('payment-signature') ?? request.header('x-payment')
    if (paymentAuthorization) {
      const reservation = reports.reserveClaim(reportId, Date.now(), CLAIM_RESERVATION_TTL_MS)
      if (reservation === 'not-found') {
        response.status(404).json({ error: 'Prepared report not found.' })
        return
      }
      if (reservation === 'already-settled') {
        const settled = reports.get(reportId)
        if (settled) response.json({ report: settled })
        else response.status(404).json({ error: 'Prepared report not found.' })
        return
      }
      if (reservation === 'in-progress') {
        response.status(409).json({
          error:
            'This report is already being claimed. Wait for settlement or use recovery if a receipt was lost.',
        })
        return
      }
      response.locals.claimReserved = true
    }
    response.locals.report = report
    next()
  }
}

/**
 * Invalid x402 authorizations can retry. Ambiguous facilitator 5xx outcomes
 * stay reserved and require receipt recovery, preventing a second payment.
 */
export function releaseRejectedClaim(
  reports: ReportRepository,
  middleware: RequestHandler,
): RequestHandler {
  return (request, response, next) => {
    response.once('finish', () => {
      if (
        !response.locals.claimReserved ||
        response.statusCode < 400 ||
        response.statusCode >= 500
      ) {
        return
      }
      const reportId = (request.body as { reportId?: unknown } | undefined)?.reportId
      if (typeof reportId === 'string') reports.releaseClaim(reportId)
    })
    middleware(request, response, next)
  }
}

export function claimedReport(response: Response): PreparedReport {
  return response.locals.report as PreparedReport
}

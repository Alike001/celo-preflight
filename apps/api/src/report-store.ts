import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { PaymentReceipt, PreparedReport } from '@preflight/shared'

interface ReportRow {
  report_json: string
}

export interface PaymentMetrics {
  /** Settled reports with an issuer-bound x402 receipt. */
  settledReports: number
  /** Distinct payer addresses represented by those receipts. */
  distinctPayers: number
}

export interface ReportRepository {
  save(report: PreparedReport): void
  get(id: string): PreparedReport | undefined
  list(limit: number): PreparedReport[]
  hasPaymentTransaction(transactionHash: string): boolean
  attachPayment(id: string, receipt: PaymentReceipt): PreparedReport | undefined
  paymentMetrics(): PaymentMetrics
}

export class ReportStore implements ReportRepository {
  private readonly database: DatabaseSync

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.database = new DatabaseSync(join(dataDir, 'preflight.db'))
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        verdict TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        report_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reports_created_at ON reports(created_at DESC);
    `)
  }

  save(report: PreparedReport): void {
    this.database
      .prepare(
        `INSERT INTO reports (id, request_hash, verdict, created_at, expires_at, report_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET report_json = excluded.report_json`,
      )
      .run(
        report.id,
        report.requestHash,
        report.verdict,
        report.createdAt,
        report.expiresAt,
        JSON.stringify(report),
      )
  }

  get(id: string): PreparedReport | undefined {
    const row = this.database.prepare('SELECT report_json FROM reports WHERE id = ?').get(id) as
      | ReportRow
      | undefined
    return row ? (JSON.parse(row.report_json) as PreparedReport) : undefined
  }

  list(limit: number): PreparedReport[] {
    const rows = this.database
      .prepare('SELECT report_json FROM reports ORDER BY created_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 100))) as unknown as ReportRow[]
    return rows.map((row) => JSON.parse(row.report_json) as PreparedReport)
  }

  hasPaymentTransaction(transactionHash: string): boolean {
    const row = this.database
      .prepare(
        `SELECT 1 FROM reports
         WHERE lower(json_extract(report_json, '$.payment.transactionHash')) = lower(?)
         LIMIT 1`,
      )
      .get(transactionHash)
    return Boolean(row)
  }

  paymentMetrics(): PaymentMetrics {
    const row = this.database
      .prepare(
        `SELECT
           count(*) AS settled_reports,
           count(DISTINCT lower(json_extract(report_json, '$.payment.payer'))) AS distinct_payers
         FROM reports
         WHERE json_extract(report_json, '$.payment.transactionHash') IS NOT NULL
           AND json_extract(report_json, '$.paymentSignature') IS NOT NULL`,
      )
      .get() as { settled_reports: number; distinct_payers: number }
    return { settledReports: row.settled_reports, distinctPayers: row.distinct_payers }
  }

  attachPayment(id: string, receipt: PaymentReceipt): PreparedReport | undefined {
    const report = this.get(id)
    if (!report) return undefined
    const updated = { ...report, payment: receipt }
    this.save(updated)
    return updated
  }
}

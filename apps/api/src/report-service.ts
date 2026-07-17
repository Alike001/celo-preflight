import type { PrepareResponse, PreparedReport, TransactionDraft } from '@preflight/shared'
import { evaluateInspection, RULESET_VERSION } from '@preflight/engine'
import { contentHash } from './canonical.js'
import type { ChainInspector } from './chain-inspector.js'
import type { ReportSigner } from './report-signer.js'
import type { ReportRepository } from './report-store.js'

const REPORT_TTL_MS = 10 * 60 * 1000

export class ReportService {
  constructor(
    private readonly inspector: Pick<ChainInspector, 'inspect'>,
    private readonly signer: Pick<ReportSigner, 'issuer' | 'sign'>,
    private readonly reports: ReportRepository,
  ) {}

  async prepare(
    transaction: TransactionDraft,
    mode: PrepareResponse['mode'],
  ): Promise<PrepareResponse> {
    const facts = await this.inspector.inspect(transaction)
    const evaluation = evaluateInspection(facts)
    const requestHash = contentHash(transaction)
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + REPORT_TTL_MS).toISOString()
    const id = contentHash({
      requestHash,
      rulesetVersion: RULESET_VERSION,
      blockNumber: facts.snapshot.blockNumber,
      issuer: this.signer.issuer,
    })
    const unsigned: PreparedReport = {
      id,
      requestHash,
      rulesetVersion: RULESET_VERSION,
      verdict: evaluation.verdict,
      createdAt,
      expiresAt,
      issuer: this.signer.issuer,
      facts,
      checks: evaluation.checks,
    }
    const signature = await this.signer.sign(contentHash(unsigned))
    const report: PreparedReport = { ...unsigned, signature }
    this.reports.save(report)
    const prepared = {
      id,
      requestHash,
      rulesetVersion: RULESET_VERSION,
      verdict: report.verdict,
      createdAt,
      expiresAt,
      issuer: report.issuer,
    }
    return mode === 'local-free'
      ? { mode, claimRequired: false, prepared, report }
      : { mode, claimRequired: true, prepared }
  }
}

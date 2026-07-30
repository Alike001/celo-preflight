import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PreparedReport } from '@preflight/shared'

export function reportSummary(report: PreparedReport) {
  return {
    id: report.id,
    requestHash: report.requestHash,
    rulesetVersion: report.rulesetVersion,
    verdict: report.verdict,
    createdAt: report.createdAt,
    expiresAt: report.expiresAt,
    issuer: report.issuer,
    chainId: report.facts.transaction.chainId,
    to: report.facts.transaction.to,
    paid: Boolean(report.payment),
  }
}

export function webDistDirectory(): string | undefined {
  const configured = process.env.WEB_DIST_DIR
  const bundled = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
  const directory = configured ?? bundled
  return existsSync(resolve(directory, 'index.html')) ? directory : undefined
}

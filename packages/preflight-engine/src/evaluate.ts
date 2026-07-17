import type { CheckEvidence, InspectionFacts, Verdict } from '@preflight/shared'
import {
  approvalRule,
  attributionRule,
  decodeRule,
  feeCurrencyRule,
  mentoTradabilityRule,
  simulationRule,
  slippageDeadlineRule,
} from './rules.js'

export interface Evaluation {
  verdict: Verdict
  checks: CheckEvidence[]
}

export function verdictFromChecks(checks: CheckEvidence[]): Verdict {
  if (checks.some((check) => check.status === 'FAIL')) return 'BLOCK'
  if (checks.some((check) => check.status === 'WARN')) return 'CAUTION'
  return 'CLEAR'
}

export function evaluateInspection(facts: InspectionFacts): Evaluation {
  const checks = [
    simulationRule(facts),
    decodeRule(facts),
    approvalRule(facts),
    mentoTradabilityRule(facts),
    slippageDeadlineRule(facts),
    feeCurrencyRule(facts),
    attributionRule(facts),
  ]
  return { verdict: verdictFromChecks(checks), checks }
}

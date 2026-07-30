import type { CheckEvidence, InspectionFacts, Verdict } from '@preflight/shared'
import {
  decodeRule,
  feeCurrencyRule,
  mentoTradabilityRule,
  simulationRule,
  slippageDeadlineRule,
} from './rules.js'
import { approvalRule, erc20ReturnRule, tokenIdentityRule } from './token-rules.js'
import { attributionRule } from './attribution.js'

export interface Evaluation {
  verdict: Verdict
  checks: CheckEvidence[]
}

export interface EvaluationOptions {
  /** The organizer-assigned ERC-8021 code that receives Track 1 credit. */
  requiredAttributionCode?: string | undefined
}

export function verdictFromChecks(checks: CheckEvidence[]): Verdict {
  if (checks.some((check) => check.status === 'FAIL')) return 'BLOCK'
  if (checks.some((check) => check.status === 'WARN')) return 'CAUTION'
  return 'CLEAR'
}

export function evaluateInspection(
  facts: InspectionFacts,
  options: EvaluationOptions = {},
): Evaluation {
  const checks = [
    simulationRule(facts),
    decodeRule(facts),
    tokenIdentityRule(facts),
    erc20ReturnRule(facts),
    approvalRule(facts),
    mentoTradabilityRule(facts),
    slippageDeadlineRule(facts),
    feeCurrencyRule(facts),
    attributionRule(facts, options.requiredAttributionCode),
  ]
  return { verdict: verdictFromChecks(checks), checks }
}

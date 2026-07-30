import type { CheckEvidence, CheckStatus, InspectionFacts } from '@preflight/shared'
import { MAX_UINT256, VERIFIED_ERC20_TOKENS } from './constants.js'

function evidence(
  id: string,
  title: string,
  status: CheckStatus,
  summary: string,
  details: CheckEvidence['details'] = {},
): CheckEvidence {
  return { id, title, status, summary, details }
}

function isVerifiedToken(facts: InspectionFacts, token: string): boolean {
  return (VERIFIED_ERC20_TOKENS[facts.transaction.chainId] ?? []).some(
    (candidate) => candidate.toLowerCase() === token.toLowerCase(),
  )
}

export function tokenIdentityRule(facts: InspectionFacts): CheckEvidence {
  if (facts.decoded.kind !== 'erc20-transfer' && facts.decoded.kind !== 'erc20-approve') {
    return evidence(
      'TOKEN_IDENTITY',
      'Token contract identity',
      'NOT_APPLICABLE',
      'No ERC-20 token call was decoded.',
    )
  }
  if (isVerifiedToken(facts, facts.decoded.token)) {
    return evidence(
      'TOKEN_IDENTITY',
      'Token contract identity',
      'PASS',
      'The target matches an explicitly verified Celo token in this ruleset.',
      { token: facts.decoded.token },
    )
  }
  return evidence(
    'TOKEN_IDENTITY',
    'Token contract identity',
    'WARN',
    'The selector decodes as ERC-20, but this token target is not in the verified Celo token registry.',
    { token: facts.decoded.token },
  )
}

export function erc20ReturnRule(facts: InspectionFacts): CheckEvidence {
  if (facts.decoded.kind !== 'erc20-transfer' && facts.decoded.kind !== 'erc20-approve') {
    return evidence(
      'ERC20_RETURN',
      'ERC-20 return value',
      'NOT_APPLICABLE',
      'No ERC-20 transfer or approval was decoded.',
    )
  }
  if (facts.simulation.status !== 'success') {
    return evidence(
      'ERC20_RETURN',
      'ERC-20 return value',
      'NOT_APPLICABLE',
      'The call did not complete, so no ERC-20 return value can be evaluated.',
    )
  }
  const result = facts.simulation.returnData
  if (result === '0x' || result === undefined) {
    return evidence(
      'ERC20_RETURN',
      'ERC-20 return value',
      'WARN',
      'The simulation did not return the ERC-20 success boolean.',
    )
  }
  const word = /^0x[0-9a-fA-F]{64}$/.test(result) ? BigInt(result) : undefined
  if (word === 1n) {
    return evidence('ERC20_RETURN', 'ERC-20 return value', 'PASS', 'The token returned true.')
  }
  if (word === 0n) {
    return evidence('ERC20_RETURN', 'ERC-20 return value', 'FAIL', 'The token returned false.')
  }
  return evidence(
    'ERC20_RETURN',
    'ERC-20 return value',
    'WARN',
    'The token returned a non-standard ERC-20 result.',
    { returnData: result },
  )
}

export function approvalRule(facts: InspectionFacts): CheckEvidence {
  if (facts.decoded.kind !== 'erc20-approve') {
    return evidence(
      'APPROVAL_SCOPE',
      'Token approval scope',
      'NOT_APPLICABLE',
      'No ERC-20 approval was decoded.',
    )
  }
  const amount = facts.decoded.amount
  if (amount === MAX_UINT256) {
    return evidence(
      'APPROVAL_SCOPE',
      'Token approval scope',
      'FAIL',
      'The approval grants an unlimited allowance.',
      { spender: facts.decoded.spender, amount },
    )
  }
  if (amount === '0') {
    return evidence(
      'APPROVAL_SCOPE',
      'Token approval scope',
      'PASS',
      'This transaction revokes the allowance.',
      { spender: facts.decoded.spender },
    )
  }
  return evidence(
    'APPROVAL_SCOPE',
    'Token approval scope',
    'WARN',
    'The allowance is finite, but no intended spend is encoded in this standalone approval.',
    { spender: facts.decoded.spender, amount },
  )
}

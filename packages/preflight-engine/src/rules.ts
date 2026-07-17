import type { CheckEvidence, CheckStatus, InspectionFacts } from '@preflight/shared'
import { MAX_UINT256 } from './constants.js'

function evidence(
  id: string,
  title: string,
  status: CheckStatus,
  summary: string,
  details: CheckEvidence['details'] = {},
): CheckEvidence {
  return { id, title, status, summary, details }
}

export function simulationRule(facts: InspectionFacts): CheckEvidence {
  const simulation = facts.simulation
  if (simulation.status === 'success') {
    return evidence(
      'SIMULATION',
      'Transaction simulation',
      'PASS',
      'Call completed at the snapshot block.',
      {
        blockNumber: facts.snapshot.blockNumber,
        gasEstimate: simulation.gasEstimate ?? 'Not returned',
      },
    )
  }
  if (simulation.status === 'revert') {
    return evidence(
      'SIMULATION',
      'Transaction simulation',
      'FAIL',
      'The transaction reverted during simulation.',
      {
        error: simulation.error ?? 'No revert reason returned',
      },
    )
  }
  return evidence(
    'SIMULATION',
    'Transaction simulation',
    'FAIL',
    'The RPC could not produce a simulation.',
    {
      error: simulation.error ?? 'RPC unavailable',
    },
  )
}

export function decodeRule(facts: InspectionFacts): CheckEvidence {
  if (facts.decoded.kind === 'unknown') {
    return evidence('CALL_DECODE', 'Call decoding', 'WARN', facts.decoded.reason, {
      selector: facts.decoded.selector,
    })
  }
  return evidence(
    'CALL_DECODE',
    'Call decoding',
    'PASS',
    'The transaction uses a supported call shape.',
    {
      callKind: facts.decoded.kind,
    },
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
      {
        spender: facts.decoded.spender,
        amount,
      },
    )
  }
  if (amount === '0') {
    return evidence(
      'APPROVAL_SCOPE',
      'Token approval scope',
      'PASS',
      'This transaction revokes the allowance.',
      {
        spender: facts.decoded.spender,
      },
    )
  }
  return evidence(
    'APPROVAL_SCOPE',
    'Token approval scope',
    'WARN',
    'The allowance is finite, but no intended spend is encoded in this standalone approval.',
    {
      spender: facts.decoded.spender,
      amount,
    },
  )
}

export function mentoTradabilityRule(facts: InspectionFacts): CheckEvidence {
  if (facts.decoded.kind !== 'mento-swap') {
    return evidence(
      'MENTO_TRADABILITY',
      'Mento route and trading state',
      'NOT_APPLICABLE',
      'No Mento swap was decoded.',
    )
  }
  if (facts.decoded.routes.length === 0) {
    return evidence(
      'MENTO_TRADABILITY',
      'Mento route and trading state',
      'FAIL',
      'The Mento route is empty.',
    )
  }
  if (facts.decoded.tradable === false) {
    return evidence(
      'MENTO_TRADABILITY',
      'Mento route and trading state',
      'FAIL',
      'At least one Mento market in this route is suspended.',
      {
        hops: facts.decoded.routes.length,
      },
    )
  }
  if (facts.decoded.tradable === undefined) {
    return evidence(
      'MENTO_TRADABILITY',
      'Mento route and trading state',
      'WARN',
      'The route decoded, but live tradability evidence was not available.',
      {
        hops: facts.decoded.routes.length,
      },
    )
  }
  return evidence(
    'MENTO_TRADABILITY',
    'Mento route and trading state',
    'PASS',
    'Every market in the decoded Mento route is currently tradable.',
    {
      hops: facts.decoded.routes.length,
    },
  )
}

function worst(left: CheckStatus, right: CheckStatus): CheckStatus {
  const weight: Record<CheckStatus, number> = {
    NOT_APPLICABLE: 0,
    PASS: 1,
    WARN: 2,
    FAIL: 3,
  }
  return weight[left] >= weight[right] ? left : right
}

export function slippageDeadlineRule(facts: InspectionFacts): CheckEvidence {
  if (facts.decoded.kind !== 'mento-swap') {
    return evidence(
      'SLIPPAGE_DEADLINE',
      'Slippage and deadline',
      'NOT_APPLICABLE',
      'No Mento swap was decoded.',
    )
  }
  const decoded = facts.decoded
  const deadline = BigInt(decoded.deadline)
  const observedAt = BigInt(facts.snapshot.observedAt)
  let status: CheckStatus = 'PASS'
  const notes: string[] = []

  if (deadline <= observedAt) {
    status = 'FAIL'
    notes.push('Deadline expired at the snapshot block.')
  } else if (deadline - observedAt <= 120n) {
    status = 'WARN'
    notes.push('Deadline expires within two minutes of the snapshot.')
  } else {
    notes.push('Deadline has more than two minutes remaining.')
  }

  let slippageBps = 'Unknown'
  if (decoded.quotedAmountOut === undefined) {
    status = worst(status, 'WARN')
    notes.push('A snapshot quote was not available, so slippage cannot be proven.')
  } else {
    const quote = BigInt(decoded.quotedAmountOut)
    const minimum = BigInt(decoded.amountOutMin)
    if (quote === 0n || minimum > quote) {
      status = 'FAIL'
      notes.push('The minimum output is incompatible with the snapshot quote.')
    } else {
      const bps = ((quote - minimum) * 10_000n) / quote
      slippageBps = bps.toString()
      if (bps > 500n) status = 'FAIL'
      else if (bps > 100n) status = worst(status, 'WARN')
      notes.push(`Effective slippage tolerance is ${bps.toString()} basis points.`)
    }
  }

  return evidence('SLIPPAGE_DEADLINE', 'Slippage and deadline', status, notes.join(' '), {
    deadline: decoded.deadline,
    amountOutMin: decoded.amountOutMin,
    quotedAmountOut: decoded.quotedAmountOut ?? 'Unavailable',
    slippageBps,
  })
}

export function feeCurrencyRule(facts: InspectionFacts): CheckEvidence {
  const feeCurrency = facts.transaction.feeCurrency
  if (!feeCurrency) {
    return evidence('FEE_CURRENCY', 'Celo fee currency', 'PASS', 'Gas will be paid in native CELO.')
  }
  if (facts.feeCurrencyAllowed === true) {
    return evidence(
      'FEE_CURRENCY',
      'Celo fee currency',
      'PASS',
      'The fee currency is in Celo’s onchain directory.',
      { feeCurrency },
    )
  }
  if (facts.feeCurrencyAllowed === false) {
    return evidence(
      'FEE_CURRENCY',
      'Celo fee currency',
      'FAIL',
      'The fee currency is not in Celo’s onchain directory.',
      { feeCurrency },
    )
  }
  return evidence(
    'FEE_CURRENCY',
    'Celo fee currency',
    'WARN',
    'The fee-currency directory could not be checked.',
    { feeCurrency },
  )
}

export function attributionRule(facts: InspectionFacts): CheckEvidence {
  if (facts.attributionCodes.length > 0) {
    return evidence(
      'ERC_8021',
      'ERC-8021 attribution',
      'PASS',
      'Attribution suffix data is present.',
      {
        codes: facts.attributionCodes,
      },
    )
  }
  return evidence(
    'ERC_8021',
    'ERC-8021 attribution',
    'WARN',
    'No ERC-8021 attribution code was found.',
    {
      impact: 'The transaction can execute, but Track 1 activity may not be credited.',
    },
  )
}

import { describe, expect, it } from 'vitest'
import type { CheckEvidence, InspectionFacts } from '@preflight/shared'
import { MAX_UINT256 } from './constants.js'
import { evaluateInspection, verdictFromChecks } from './evaluate.js'

const address = (digit: string) => `0x${digit.repeat(40)}` as const
const assignedCode = 'celo_preflight_test'

function baseFacts(overrides: Partial<InspectionFacts> = {}): InspectionFacts {
  return {
    transaction: {
      chainId: 42220,
      from: address('1'),
      to: address('2'),
      valueWei: '1',
      data: '0x',
    },
    snapshot: { blockNumber: '100', observedAt: 1_000 },
    simulation: { status: 'success', gasEstimate: '21000' },
    decoded: { kind: 'native-transfer', recipient: address('2'), amount: '1' },
    attributionCodes: ['celo_preflight_test'],
    ...overrides,
  }
}

function mentoFacts(
  overrides: Partial<Extract<InspectionFacts['decoded'], { kind: 'mento-swap' }>> = {},
  omit?: 'tradable' | 'quote',
): InspectionFacts {
  const decoded: Extract<InspectionFacts['decoded'], { kind: 'mento-swap' }> = {
    kind: 'mento-swap',
    router: address('9'),
    amountIn: '1000',
    amountOutMin: '990',
    routes: [{ from: address('2'), to: address('3'), factory: address('4') }],
    recipient: address('5'),
    deadline: '1300',
    quotedAmountOut: '1000',
    tradable: true,
    ...overrides,
  }
  if (omit === 'tradable') delete decoded.tradable
  if (omit === 'quote') delete decoded.quotedAmountOut
  return baseFacts({
    decoded,
  })
}

function check(facts: InspectionFacts, id: string): CheckEvidence {
  const found = evaluateInspection(facts, { requiredAttributionCode: assignedCode }).checks.find(
    (item) => item.id === id,
  )
  if (!found) throw new Error(`Missing check ${id}`)
  return found
}

describe('deterministic evaluation', () => {
  it('returns CLEAR when every applicable rule passes', () => {
    expect(evaluateInspection(baseFacts(), { requiredAttributionCode: assignedCode }).verdict).toBe(
      'CLEAR',
    )
  })

  it('returns CAUTION when attribution is missing', () => {
    const result = evaluateInspection(baseFacts({ attributionCodes: [] }), {
      requiredAttributionCode: assignedCode,
    })
    expect(result.verdict).toBe('CAUTION')
    expect(result.checks.at(-1)).toMatchObject({
      id: 'ERC_8021',
      status: 'WARN',
    })
  })

  it.each([
    [{ status: 'revert', error: 'execution reverted' } as const, 'The transaction reverted'],
    [{ status: 'unavailable', error: 'timeout' } as const, 'could not produce'],
  ])('blocks failed simulation evidence', (simulation, summary) => {
    const result = evaluateInspection(baseFacts({ simulation }))
    expect(result.verdict).toBe('BLOCK')
    expect(result.checks[0]?.summary).toContain(summary)
  })

  it('uses safe fallback details when the RPC gives no failure message', () => {
    expect(check(baseFacts({ simulation: { status: 'revert' } }), 'SIMULATION').details.error).toBe(
      'No revert reason returned',
    )
    expect(
      check(baseFacts({ simulation: { status: 'unavailable' } }), 'SIMULATION').details.error,
    ).toBe('RPC unavailable')
  })

  it('warns for unsupported calldata', () => {
    const facts = baseFacts({
      decoded: {
        kind: 'unknown',
        selector: '0x12345678',
        reason: 'Unsupported',
      },
    })
    expect(check(facts, 'CALL_DECODE')).toMatchObject({
      status: 'WARN',
      summary: 'Unsupported',
    })
    expect(evaluateInspection(facts, { requiredAttributionCode: assignedCode }).verdict).toBe(
      'CAUTION',
    )
  })

  it.each([
    [MAX_UINT256, 'FAIL', 'BLOCK'],
    ['1', 'WARN', 'CAUTION'],
    ['0', 'PASS', 'CLEAR'],
  ] as const)('classifies ERC-20 approval amount %s', (amount, status, verdict) => {
    const facts = baseFacts({
      decoded: {
        kind: 'erc20-approve',
        token: address('2'),
        spender: address('3'),
        amount,
      },
    })
    expect(check(facts, 'APPROVAL_SCOPE').status).toBe(status)
    expect(evaluateInspection(facts, { requiredAttributionCode: assignedCode }).verdict).toBe(
      verdict,
    )
  })

  it('passes a fully evidenced Mento route', () => {
    expect(
      evaluateInspection(mentoFacts(), { requiredAttributionCode: assignedCode }).verdict,
    ).toBe('CLEAR')
    expect(check(mentoFacts(), 'MENTO_TRADABILITY').status).toBe('PASS')
    expect(check(mentoFacts(), 'SLIPPAGE_DEADLINE').details.slippageBps).toBe('100')
  })

  it.each([
    [{ routes: [] as never[] }, 'MENTO_TRADABILITY', 'FAIL', 'BLOCK'],
    [{ tradable: false }, 'MENTO_TRADABILITY', 'FAIL', 'BLOCK'],
    [{ amountOutMin: '980' }, 'SLIPPAGE_DEADLINE', 'WARN', 'CAUTION'],
    [{ amountOutMin: '949' }, 'SLIPPAGE_DEADLINE', 'FAIL', 'BLOCK'],
    [{ amountOutMin: '1001' }, 'SLIPPAGE_DEADLINE', 'FAIL', 'BLOCK'],
    [{ quotedAmountOut: '0', amountOutMin: '0' }, 'SLIPPAGE_DEADLINE', 'FAIL', 'BLOCK'],
    [{ deadline: '1100' }, 'SLIPPAGE_DEADLINE', 'WARN', 'CAUTION'],
    [{ deadline: '1000' }, 'SLIPPAGE_DEADLINE', 'FAIL', 'BLOCK'],
  ] as const)('classifies Mento evidence deterministically', (override, id, status, verdict) => {
    const facts = mentoFacts(override)
    expect(check(facts, id).status).toBe(status)
    expect(evaluateInspection(facts, { requiredAttributionCode: assignedCode }).verdict).toBe(
      verdict,
    )
  })

  it('warns when live Mento tradability evidence is missing', () => {
    const facts = mentoFacts({}, 'tradable')
    expect(check(facts, 'MENTO_TRADABILITY').status).toBe('WARN')
    expect(evaluateInspection(facts, { requiredAttributionCode: assignedCode }).verdict).toBe(
      'CAUTION',
    )
  })

  it('warns when a Mento snapshot quote is missing', () => {
    const facts = mentoFacts({}, 'quote')
    expect(check(facts, 'SLIPPAGE_DEADLINE').status).toBe('WARN')
    expect(evaluateInspection(facts, { requiredAttributionCode: assignedCode }).verdict).toBe(
      'CAUTION',
    )
  })

  it.each([
    [true, 'PASS', 'CLEAR'],
    [false, 'FAIL', 'BLOCK'],
    [undefined, 'WARN', 'CAUTION'],
  ] as const)(
    'checks an explicit Celo fee currency against onchain evidence',
    (allowed, status, verdict) => {
      const transaction = {
        ...baseFacts().transaction,
        feeCurrency: address('8'),
      }
      const facts = baseFacts({
        transaction,
        ...(allowed === undefined ? {} : { feeCurrencyAllowed: allowed }),
      })
      expect(check(facts, 'FEE_CURRENCY').status).toBe(status)
      expect(evaluateInspection(facts, { requiredAttributionCode: assignedCode }).verdict).toBe(
        verdict,
      )
    },
  )

  it('prioritizes FAIL over WARN and WARN over PASS', () => {
    const item = (status: CheckEvidence['status']): CheckEvidence => ({
      id: status,
      title: status,
      status,
      summary: status,
      details: {},
    })
    expect(verdictFromChecks([item('PASS')])).toBe('CLEAR')
    expect(verdictFromChecks([item('PASS'), item('WARN')])).toBe('CAUTION')
    expect(verdictFromChecks([item('WARN'), item('FAIL')])).toBe('BLOCK')
  })

  it('does not treat an arbitrary attribution suffix as Track 1 credit', () => {
    const result = evaluateInspection(baseFacts(), { requiredAttributionCode: 'celo_assigned_tag' })
    expect(result.verdict).toBe('CAUTION')
    expect(result.checks.at(-1)).toMatchObject({
      id: 'ERC_8021',
      status: 'WARN',
      details: { requiredCode: 'celo_assigned_tag', observedCodes: ['celo_preflight_test'] },
    })
  })

  it('marks Track 1 credit unproven when no assigned tag is configured', () => {
    const result = evaluateInspection(baseFacts())
    expect(result.verdict).toBe('CAUTION')
    expect(result.checks.at(-1)).toMatchObject({
      id: 'ERC_8021',
      status: 'WARN',
    })
  })
})

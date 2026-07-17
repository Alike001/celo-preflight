import type { CheckEvidence, InspectionFacts } from '@preflight/shared'

function evidence(
  status: CheckEvidence['status'],
  summary: string,
  details: CheckEvidence['details'],
): CheckEvidence {
  return {
    id: 'ERC_8021',
    title: 'ERC-8021 hackathon attribution',
    status,
    summary,
    details,
  }
}

export function attributionRule(
  facts: InspectionFacts,
  requiredAttributionCode?: string,
): CheckEvidence {
  if (!requiredAttributionCode) {
    return evidence(
      'WARN',
      'The assigned hackathon attribution tag is not configured, so Track 1 credit cannot be established.',
      {
        observedCodes: facts.attributionCodes,
        impact: 'The transaction can execute, but this deployment cannot prove Track 1 credit.',
      },
    )
  }

  const hasAssignedCode = facts.attributionCodes.some(
    (code) => code.toLowerCase() === requiredAttributionCode.toLowerCase(),
  )
  if (hasAssignedCode) {
    return evidence('PASS', 'The organizer-assigned hackathon attribution tag is present.', {
      requiredCode: requiredAttributionCode,
      observedCodes: facts.attributionCodes,
    })
  }
  return evidence('WARN', 'The organizer-assigned hackathon attribution tag is absent.', {
    requiredCode: requiredAttributionCode,
    observedCodes: facts.attributionCodes,
    impact:
      'The transaction can execute, but Track 1 activity will not be credited to this project.',
  })
}

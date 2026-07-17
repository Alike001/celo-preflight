import { Check, Minus, OctagonX, TriangleAlert } from 'lucide-react'
import type { CheckStatus, Verdict } from '@preflight/shared'

type Status = CheckStatus | Verdict

export function StatusIcon({ status }: { status: Status }) {
  const className = `status-icon status-${status.toLowerCase().replace('_', '-')}`
  if (status === 'PASS' || status === 'CLEAR') return <Check className={className} aria-hidden />
  if (status === 'WARN' || status === 'CAUTION') {
    return <TriangleAlert className={className} aria-hidden />
  }
  if (status === 'FAIL' || status === 'BLOCK') return <OctagonX className={className} aria-hidden />
  return <Minus className={className} aria-hidden />
}

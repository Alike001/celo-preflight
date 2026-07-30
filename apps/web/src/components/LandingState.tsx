import { ArrowRight, Clock3, EyeOff, FileCheck2, Play, Radio, ShieldCheck } from 'lucide-react'

interface LandingStateProps {
  onLoadSample: () => void
  onInspect: () => void
  onViewVerified?: () => void
  onViewHistorical?: () => void
  evidenceState?: 'loading' | 'unavailable' | 'historical-only' | 'none'
}

const workflow = [
  ['01', 'Unsigned transaction', 'Input only'],
  ['02', 'Celo evidence checks', 'Live state'],
  ['03', 'Signed verdict', 'CLEAR · CAUTION · BLOCK'],
] as const

const assurances = [
  {
    icon: Radio,
    title: 'Live Celo state',
    detail: 'Every report records its snapshot block.',
  },
  {
    icon: EyeOff,
    title: 'Never broadcast',
    detail: 'Preflight only inspects the unsigned call.',
  },
  {
    icon: ShieldCheck,
    title: 'Deterministic verdict',
    detail: 'Published rules—not AI—choose the outcome.',
  },
] as const

export function LandingState({
  onLoadSample,
  onInspect,
  onViewVerified,
  onViewHistorical,
  evidenceState = 'none',
}: LandingStateProps) {
  return (
    <section className="landing-state" aria-labelledby="landing-heading">
      <div className="landing-intro">
        <h1 id="landing-heading">Know what a Celo transaction will do before you sign.</h1>
        <p>
          Simulate an unsigned transaction against live Celo state and receive a signed,
          deterministic verdict.
        </p>
        <div className="landing-actions">
          <button className="landing-primary" type="button" onClick={onLoadSample}>
            <Play aria-hidden /> Load live sample
          </button>
          <button className="landing-secondary" type="button" onClick={onInspect}>
            Inspect your transaction <ArrowRight aria-hidden />
          </button>
          {onViewVerified && (
            <button className="landing-proof" type="button" onClick={onViewVerified}>
              <FileCheck2 aria-hidden /> View current verified report
            </button>
          )}
          {onViewHistorical && (
            <button
              className="landing-proof landing-historical"
              type="button"
              onClick={onViewHistorical}
            >
              <Clock3 aria-hidden /> View historical report
            </button>
          )}
        </div>
        <p className="landing-disclosure">
          The sample supplies unsigned input only. Existing reports open without connecting a wallet
          or requesting payment.
        </p>
        {evidenceState === 'loading' && (
          <p className="landing-evidence-state" role="status">
            Checking persisted evidence…
          </p>
        )}
        {evidenceState === 'unavailable' && (
          <p className="landing-evidence-state landing-evidence-error" role="alert">
            Stored evidence is temporarily unavailable. You can still inspect unsigned input.
          </p>
        )}
        {evidenceState === 'historical-only' && (
          <p className="landing-evidence-state" role="status">
            Available paid evidence is historical only; it is never signing guidance.
          </p>
        )}
      </div>

      <div className="landing-workflow" aria-label="Preflight workflow">
        {workflow.map(([number, title, detail], index) => (
          <div className="workflow-fragment" key={number}>
            <div className="workflow-step">
              <span className="workflow-number">{number}</span>
              <span>
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
            </div>
            {index < workflow.length - 1 && <ArrowRight className="workflow-arrow" aria-hidden />}
          </div>
        ))}
      </div>

      <div className="landing-assurances">
        {assurances.map(({ icon: Icon, title, detail }) => (
          <div className="assurance-row" key={title}>
            <Icon aria-hidden />
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
            <FileCheck2 aria-hidden className="assurance-proof" />
          </div>
        ))}
      </div>
    </section>
  )
}

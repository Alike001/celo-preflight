import { ArrowRight, EyeOff, FileCheck2, Play, Radio, ShieldCheck } from 'lucide-react'

interface LandingStateProps {
  onRunSample: () => void
  onInspect: () => void
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

export function LandingState({ onRunSample, onInspect }: LandingStateProps) {
  return (
    <section className="landing-state" aria-labelledby="landing-heading">
      <div className="landing-intro">
        <h1 id="landing-heading">Know what a Celo transaction will do before you sign.</h1>
        <p>
          Simulate an unsigned transaction against live Celo state and receive a signed,
          deterministic verdict.
        </p>
        <div className="landing-actions">
          <button className="landing-primary" type="button" onClick={onRunSample}>
            <Play aria-hidden /> Run live sample
          </button>
          <button className="landing-secondary" type="button" onClick={onInspect}>
            Inspect your transaction <ArrowRight aria-hidden />
          </button>
        </div>
        <p className="landing-disclosure">
          The sample supplies unsigned input only. Its block, evidence, verdict, and signature are
          computed when you run it.
        </p>
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

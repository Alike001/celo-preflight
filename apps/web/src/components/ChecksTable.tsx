import { ChevronRight } from 'lucide-react'
import type { CheckEvidence } from '@preflight/shared'
import { StatusIcon } from './StatusIcon.js'

export function ChecksTable({
  checks,
  selectedId,
  onSelect,
}: {
  checks?: CheckEvidence[] | undefined
  selectedId?: string | undefined
  onSelect: (id: string) => void
}) {
  return (
    <section className="checks-section" aria-labelledby="checks-heading">
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">Published ruleset</span>
          <h2 id="checks-heading">Deterministic checks</h2>
        </div>
        <span className="check-count">{checks?.length ?? 0} checks</span>
      </div>
      {!checks ? (
        <div className="empty-checks">
          No opaque score. Each check and its evidence will appear here.
        </div>
      ) : (
        <div className="checks-table" role="table" aria-label="Deterministic checks">
          <div className="checks-header" role="row">
            <span>Result</span>
            <span>Rule</span>
            <span>Finding</span>
            <span />
          </div>
          {checks.map((check) => (
            <button
              type="button"
              role="row"
              className={`check-row ${selectedId === check.id ? 'check-selected' : ''}`}
              key={check.id}
              onClick={() => onSelect(check.id)}
            >
              <span className="check-result">
                <StatusIcon status={check.status} /> {check.status.replace('_', ' ')}
              </span>
              <span>
                <strong>{check.title}</strong>
                <small className="mono">{check.id}</small>
              </span>
              <span className="check-summary">{check.summary}</span>
              <ChevronRight aria-hidden />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

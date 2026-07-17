import { BookOpenText, ExternalLink, X } from 'lucide-react'
import { useEffect } from 'react'

export function DocsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="docs-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="docs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="docs-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="docs-header">
          <span className="docs-icon" aria-hidden>
            <BookOpenText size={17} />
          </span>
          <div>
            <span className="eyebrow">Product guide</span>
            <h2 id="docs-title">How Celo Preflight works</h2>
          </div>
          <button className="docs-close" type="button" onClick={onClose} autoFocus>
            <X aria-hidden size={16} />
            <span className="sr-only">Close documentation</span>
          </button>
        </header>

        <div className="docs-content">
          <p className="docs-summary">
            Inspect an unsigned Celo transaction before signing it. Preflight reads chain state,
            simulates the call, and records each rule result as evidence.
          </p>

          <section>
            <span className="eyebrow">Inspection path</span>
            <ol className="docs-steps">
              <li>
                <strong>Provide an unsigned transaction.</strong> Use the live sample or paste the
                sender, recipient, value, and calldata you intend to sign.
              </li>
              <li>
                <strong>Read a fixed Celo snapshot.</strong> The report records its block number and
                state note so every result can be checked against the same observed state.
              </li>
              <li>
                <strong>Review the evidence.</strong> Simulation, call decoding, and attribution
                checks each expose their exact inputs and outcome.
              </li>
            </ol>
          </section>

          <section>
            <span className="eyebrow">Verdicts</span>
            <dl className="docs-verdicts">
              <div>
                <dt className="docs-clear">CLEAR</dt>
                <dd>Every applicable rule has sufficient passing evidence.</dd>
              </div>
              <div>
                <dt className="docs-caution">CAUTION</dt>
                <dd>No rule blocks the call, but evidence is incomplete or ambiguous.</dd>
              </div>
              <div>
                <dt className="docs-block">BLOCK</dt>
                <dd>At least one deterministic safety rule failed.</dd>
              </div>
            </dl>
          </section>

          <section className="docs-boundary">
            <span className="eyebrow">Boundary</span>
            <p>
              Preflight does not submit your transaction. It never claims an x402 payment without a
              facilitator receipt, and AI never chooses a verdict.
            </p>
            <a href="/api/health" target="_blank" rel="noreferrer">
              Check the running API <ExternalLink aria-hidden size={13} />
            </a>
          </section>
        </div>
      </section>
    </div>
  )
}

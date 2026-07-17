import { BadgeCheck, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  verifyPreparedReport,
  type PreparedReport,
  type ReportVerification,
} from '@preflight/shared'

function resultLabel(result: ReportVerification): string {
  if (!result.integrityValid) return 'INVALID REPORT'
  return result.expired ? 'AUTHENTIC · EXPIRED' : 'AUTHENTIC REPORT'
}

export function ReportVerifierDialog({
  open,
  report,
  onClose,
}: {
  open: boolean
  report?: PreparedReport | undefined
  onClose: () => void
}) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<ReportVerification>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open) return
    setInput(report ? JSON.stringify(report, null, 2) : '')
    setResult(undefined)
    setError(undefined)
  }, [open, report])

  useEffect(() => {
    if (!open) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open])

  if (!open) return null

  async function verify() {
    setResult(undefined)
    setError(undefined)
    try {
      const parsed = JSON.parse(input) as PreparedReport
      setResult(await verifyPreparedReport(parsed))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The pasted JSON is not a report.')
    }
  }

  return (
    <div className="docs-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="docs-dialog verifier-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verifier-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="docs-header">
          <span className="docs-icon" aria-hidden>
            <ShieldCheck size={17} />
          </span>
          <div>
            <span className="eyebrow">Independent verification</span>
            <h2 id="verifier-title">Verify a signed report</h2>
          </div>
          <button className="docs-close" type="button" onClick={onClose} autoFocus>
            <X aria-hidden size={16} />
            <span className="sr-only">Close report verifier</span>
          </button>
        </header>
        <div className="docs-content">
          <p className="docs-summary">
            This runs in your browser: it rebuilds the canonical report hash and recovers the ECDSA
            signer. It does not call the Preflight API.
          </p>
          <label className="verifier-input">
            <span>Signed report JSON</span>
            <textarea
              aria-label="Signed report JSON"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              spellCheck={false}
              rows={12}
            />
          </label>
          <button className="verifier-button" type="button" onClick={() => void verify()}>
            <BadgeCheck aria-hidden size={15} /> Verify independently
          </button>
          {error && (
            <p className="verifier-error" role="alert">
              {error}
            </p>
          )}
          {result && (
            <section className={result.integrityValid ? 'verification-good' : 'verification-bad'}>
              <strong>{resultLabel(result)}</strong>
              {result.recoveredIssuer && (
                <span className="mono">Recovered: {result.recoveredIssuer}</span>
              )}
              {result.reasons.length > 0 && (
                <ul>
                  {result.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </section>
    </div>
  )
}

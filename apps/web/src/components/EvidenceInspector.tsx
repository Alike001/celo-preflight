import { Check, Clipboard, Code2, ExternalLink, FileSignature, ReceiptText } from 'lucide-react'
import { useState } from 'react'
import type { CheckEvidence, PreparedReport } from '@preflight/shared'
import { StatusIcon } from './StatusIcon.js'

function display(value: string | boolean | number | string[]) {
  return Array.isArray(value) ? value.join(', ') : String(value)
}

export function EvidenceInspector({
  report,
  selectedCheck,
  landing = false,
}: {
  report?: PreparedReport | undefined
  selectedCheck?: CheckEvidence | undefined
  landing?: boolean | undefined
}) {
  const [showRaw, setShowRaw] = useState(false)
  const [copied, setCopied] = useState(false)
  const verdict = report?.verdict

  async function copyReport() {
    if (!report) return
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  return (
    <aside className="inspector" aria-label="Verdict and evidence">
      <section className={`verdict-panel ${verdict ? `panel-${verdict.toLowerCase()}` : ''}`}>
        <span className="eyebrow">Verdict</span>
        <div className="verdict-line">
          {verdict ? <StatusIcon status={verdict} /> : <span className="awaiting-dot" />}
          <h2>
            {verdict
              ? verdict === 'CLEAR'
                ? 'CLEAR TO SIGN'
                : verdict
              : landing
                ? 'AWAITING LIVE EVIDENCE'
                : 'AWAITING INPUT'}
          </h2>
        </div>
        <p>
          {verdict === 'CLEAR'
            ? 'Every applicable rule has sufficient passing evidence.'
            : verdict === 'CAUTION'
              ? 'No blocking failure, but one or more proofs are incomplete or ambiguous.'
              : verdict === 'BLOCK'
                ? 'At least one deterministic safety rule failed.'
                : landing
                  ? 'Run the live sample or inspect your own unsigned transaction. A verdict appears only after simulation.'
                  : 'Paste an unsigned transaction to begin a live Celo inspection.'}
        </p>
        <div className="verdict-actions">
          <button type="button" disabled={!report} onClick={copyReport}>
            {copied ? <Check aria-hidden /> : <Clipboard aria-hidden />}
            {copied ? 'Copied' : 'Copy signed report'}
          </button>
          <button
            type="button"
            disabled={!report}
            onClick={() => setShowRaw((current) => !current)}
          >
            <Code2 aria-hidden /> {showRaw ? 'Hide raw' : 'View raw simulation'}
          </button>
        </div>
      </section>

      <section className="evidence-panel">
        <div className="inspector-heading">
          <span className="eyebrow">Selected evidence</span>
          {selectedCheck && <span className="mono">{selectedCheck.id}</span>}
        </div>
        {selectedCheck ? (
          <>
            <div className="selected-rule-title">
              <StatusIcon status={selectedCheck.status} />
              <div>
                <h3>{selectedCheck.title}</h3>
                <p>{selectedCheck.summary}</p>
              </div>
            </div>
            <dl className="evidence-list">
              {Object.entries(selectedCheck.details).map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replaceAll(/([A-Z])/g, ' $1')}</dt>
                  <dd className="mono">{display(value)}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <div className="empty-inspector">
            {landing
              ? 'No rule output exists yet. Live evidence will appear here after inspection.'
              : 'Select a check to inspect its exact inputs and rule output.'}
          </div>
        )}
      </section>

      {showRaw && report && (
        <section className="raw-panel">
          <div className="inspector-heading">
            <span className="eyebrow">Raw simulation</span>
            <span className="mono">block {report.facts.snapshot.blockNumber}</span>
          </div>
          <pre>{JSON.stringify(report.facts.simulation, null, 2)}</pre>
        </section>
      )}

      <section className="receipt-panel">
        <div className="inspector-heading">
          <span className="eyebrow">Settlement receipt</span>
          <ReceiptText aria-hidden />
        </div>
        {report?.payment ? (
          <dl className="receipt-list">
            <div>
              <dt>Network</dt>
              <dd className="mono">{report.payment.network}</dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd className="mono">{report.payment.transactionHash}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd className="mono">{report.payment.amount}</dd>
            </div>
          </dl>
        ) : (
          <div className="no-receipt">
            <FileSignature aria-hidden />
            <span>
              <strong>{report ? 'Local-free inspection' : 'No report yet'}</strong>
              <small>No x402 settlement is claimed without a facilitator receipt.</small>
            </span>
          </div>
        )}
      </section>

      <section className="determinism-note" id="determinism">
        <strong>Deterministic by construction</strong>
        <p>
          Same request + same state block + ruleset 1.0.0 produces the same verdict. AI never
          chooses CLEAR, CAUTION, or BLOCK.
        </p>
        <a href="/api/health" target="_blank" rel="noreferrer">
          Verify runtime <ExternalLink aria-hidden />
        </a>
      </section>
    </aside>
  )
}

import {
  Braces,
  ArrowLeft,
  FileInput,
  FlaskConical,
  Landmark,
  LoaderCircle,
  Play,
  RotateCcw,
  Wallet,
} from 'lucide-react'
import { forwardRef, useState } from 'react'
import { parseTransactionDraft, type TransactionDraft } from '@preflight/shared'
import type { Capabilities } from '../api.js'

export type FormStatus =
  | 'idle'
  | 'preparing'
  | 'awaiting-claim'
  | 'awaiting-wallet'
  | 'signing-payment'
  | 'complete'
  | 'error'

export interface TransactionFormProps {
  value: TransactionDraft
  capabilities?: Capabilities | undefined
  status: FormStatus
  message?: string | undefined
  onChange: (value: TransactionDraft) => void
  onSubmit: () => void
  onClaim?: (() => void) | undefined
  claimPrice?: string | undefined
  onSample: () => void
  onReset: () => void
  onBackToOverview: () => void
  connectedAddress?: `0x${string}` | undefined
  onUseConnectedAddress?: (address: `0x${string}`) => void
  onBuildMento?: () => void
  onLoadMentoSwap?: (() => void) | undefined
}

function update<K extends keyof TransactionDraft>(
  current: TransactionDraft,
  key: K,
  value: TransactionDraft[K],
): TransactionDraft {
  const next = { ...current, [key]: value }
  if (key === 'feeCurrency' && !value) delete next.feeCurrency
  return next
}

export const TransactionForm = forwardRef<HTMLInputElement, TransactionFormProps>(
  function TransactionForm(
    {
      value,
      capabilities,
      status,
      message,
      onChange,
      onSubmit,
      onClaim,
      claimPrice,
      onSample,
      onReset,
      onBackToOverview,
      connectedAddress,
      onUseConnectedAddress,
      onBuildMento,
      onLoadMentoSwap,
    },
    fromRef,
  ) {
    const [showImport, setShowImport] = useState(false)
    const [proposal, setProposal] = useState('')
    const [importError, setImportError] = useState<string>()
    const busy = ['preparing', 'signing-payment'].includes(status)
    const paid = capabilities?.hostedPaid === true
    const action = paid ? 'Run preflight' : 'Run local preflight'

    return (
      <section className="transaction-section" aria-labelledby="transaction-heading">
        <div className="section-heading">
          <div>
            <button className="back-to-overview" type="button" onClick={onBackToOverview}>
              <ArrowLeft aria-hidden size={14} /> Back to overview
            </button>
            <span className="eyebrow">Unsigned transaction</span>
            <h2 id="transaction-heading">Inspect before you sign</h2>
          </div>
          <div className="form-tools">
            <button type="button" onClick={() => setShowImport((current) => !current)}>
              <FileInput aria-hidden size={14} /> Import JSON
            </button>
            {connectedAddress && onBuildMento && (
              <button type="button" onClick={onBuildMento}>
                <Landmark aria-hidden size={14} /> Check live Mento route
              </button>
            )}
            {onLoadMentoSwap && (
              <button type="button" onClick={onLoadMentoSwap}>
                <Landmark aria-hidden size={14} /> Load Mento swap
              </button>
            )}
            <button type="button" onClick={onSample} title="Load labeled sample input">
              <FlaskConical aria-hidden size={14} /> Sample input
            </button>
            <button type="button" onClick={onReset} title="Clear form">
              <RotateCcw aria-hidden size={14} /> Reset
            </button>
          </div>
        </div>
        <p className="section-intro">
          Paste an unsigned Celo call. Preflight simulates it and publishes every rule behind the
          verdict.
        </p>
        {showImport && (
          <section className="proposal-import" aria-label="Import unsigned transaction proposal">
            <label>
              <span>Unsigned transaction proposal JSON</span>
              <textarea
                value={proposal}
                onChange={(event) => setProposal(event.target.value)}
                placeholder='{"chainId":42220,"from":"0x…","to":"0x…","valueWei":"0","data":"0x"}'
                spellCheck={false}
                rows={4}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                try {
                  onChange(parseTransactionDraft(JSON.parse(proposal)))
                  setImportError(undefined)
                  setShowImport(false)
                } catch (error) {
                  setImportError(
                    error instanceof Error ? error.message : 'Invalid transaction proposal.',
                  )
                }
              }}
            >
              Load proposal
            </button>
            {importError && <p role="alert">{importError}</p>}
          </section>
        )}
        <form
          className="transaction-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onSubmit()
          }}
        >
          <div className="field-grid">
            <label>
              <span>From</span>
              <input
                ref={fromRef}
                value={value.from}
                onChange={(event) =>
                  onChange(update(value, 'from', event.target.value as `0x${string}`))
                }
                placeholder="0x… wallet or smart account"
                spellCheck={false}
                required
              />
              {connectedAddress && onUseConnectedAddress && (
                <button
                  className="wallet-fill"
                  type="button"
                  onClick={() => onUseConnectedAddress(connectedAddress)}
                >
                  <Wallet aria-hidden size={12} /> Use connected wallet
                </button>
              )}
            </label>
            <label>
              <span>To</span>
              <input
                value={value.to}
                onChange={(event) =>
                  onChange(update(value, 'to', event.target.value as `0x${string}`))
                }
                placeholder="0x… contract or recipient"
                spellCheck={false}
                required
              />
            </label>
            <label>
              <span>Value · wei</span>
              <input
                inputMode="numeric"
                value={value.valueWei}
                onChange={(event) => onChange(update(value, 'valueWei', event.target.value))}
                placeholder="0"
                required
              />
            </label>
            <label>
              <span>Fee currency · optional</span>
              <input
                value={value.feeCurrency ?? ''}
                onChange={(event) =>
                  onChange(update(value, 'feeCurrency', event.target.value as `0x${string}`))
                }
                placeholder="Native CELO when empty"
                spellCheck={false}
              />
            </label>
          </div>
          <label className="calldata-field">
            <span>
              <Braces aria-hidden size={14} /> Calldata
            </span>
            <textarea
              value={value.data}
              onChange={(event) =>
                onChange(update(value, 'data', event.target.value as `0x${string}`))
              }
              placeholder="0x"
              spellCheck={false}
              rows={5}
              required
            />
          </label>
          {message && (
            <div
              className={`form-message message-${status}`}
              role={status === 'error' ? 'alert' : 'status'}
            >
              {message}
            </div>
          )}
          <div className="run-row">
            <button className="run-button" type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" aria-hidden /> : <Play aria-hidden />}
              {status === 'preparing'
                ? 'Simulating on Celo…'
                : status === 'signing-payment'
                  ? 'Authorize x402 payment…'
                  : action}
              <kbd>⌘↵</kbd>
            </button>
            {onClaim && claimPrice && (
              <button className="claim-button" type="button" disabled={busy} onClick={onClaim}>
                Claim signed report · {claimPrice}
              </button>
            )}
            <p>
              {paid
                ? onClaim
                  ? 'This preview is unsigned. Claim only if you need the portable signed report and settlement receipt.'
                  : 'Simulation is free. Payment is requested only after you choose to claim a signed report.'
                : 'Local-free mode · real rules and RPC evidence · no settlement receipt.'}
            </p>
          </div>
        </form>
      </section>
    )
  },
)

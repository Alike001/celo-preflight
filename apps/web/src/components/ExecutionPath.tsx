import { ArrowRight, CircleHelp, Coins, Route, ShieldCheck, UserRound, Wallet } from 'lucide-react'
import type { DecodedCall } from '@preflight/shared'

function path(decoded: DecodedCall) {
  if (decoded.kind === 'native-transfer') {
    return [
      { label: 'Wallet', detail: 'Native CELO', icon: Wallet },
      { label: 'Recipient', detail: decoded.recipient, icon: UserRound },
    ]
  }
  if (decoded.kind === 'erc20-transfer') {
    return [
      { label: 'Wallet', detail: 'Sender', icon: Wallet },
      { label: 'ERC-20 transfer', detail: decoded.token, icon: Coins },
      { label: 'Recipient', detail: decoded.recipient, icon: UserRound },
    ]
  }
  if (decoded.kind === 'erc20-approve') {
    return [
      { label: 'Wallet', detail: 'Owner', icon: Wallet },
      { label: 'Allowance', detail: decoded.token, icon: ShieldCheck },
      { label: 'Spender', detail: decoded.spender, icon: UserRound },
    ]
  }
  if (decoded.kind === 'mento-swap') {
    return [
      { label: 'Wallet', detail: 'Sender', icon: Wallet },
      { label: 'Mento Router', detail: `${decoded.routes.length} hop route`, icon: Route },
      { label: 'Recipient', detail: decoded.recipient, icon: UserRound },
    ]
  }
  return [
    { label: 'Wallet', detail: 'Sender', icon: Wallet },
    { label: 'Unknown call', detail: decoded.selector, icon: CircleHelp },
  ]
}

export function ExecutionPath({ decoded }: { decoded?: DecodedCall | undefined }) {
  return (
    <section className="execution-section" aria-labelledby="execution-heading">
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">Decoded intent</span>
          <h2 id="execution-heading">Execution path</h2>
        </div>
      </div>
      {!decoded ? (
        <div className="empty-path">Run preflight to decode the execution path.</div>
      ) : (
        <div className="execution-path">
          {path(decoded).map((step, index, steps) => {
            const Icon = step.icon
            return (
              <div className="path-fragment" key={`${step.label}-${index}`}>
                <div className="path-step">
                  <Icon aria-hidden />
                  <span>
                    <strong>{step.label}</strong>
                    <small className="mono">{step.detail}</small>
                  </span>
                </div>
                {index < steps.length - 1 && <ArrowRight className="path-arrow" aria-hidden />}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

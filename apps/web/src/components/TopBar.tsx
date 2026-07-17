import { Cable, ChevronDown, Unplug } from 'lucide-react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import type { SupportedChainId } from '@preflight/shared'

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function TopBar({
  chainId,
  onChainChange,
  onOpenDocs,
}: {
  chainId: SupportedChainId
  onChainChange: (chainId: SupportedChainId) => void
  onOpenDocs: () => void
}) {
  const account = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  return (
    <header className="topbar">
      <div className="brand-lockup" aria-label="Celo Preflight">
        <span className="brand-mark">CP</span>
        <span className="brand-name">Celo Preflight</span>
        <span className="brand-tag">Deterministic safety inspector</span>
      </div>
      <nav className="top-actions" aria-label="Application">
        <label className="network-control">
          <span className="sr-only">Inspection network</span>
          <span className="network-dot" />
          <select
            value={chainId}
            onChange={(event) => onChainChange(Number(event.target.value) as SupportedChainId)}
          >
            <option value={42220}>Celo Mainnet</option>
            <option value={11142220}>Celo Sepolia</option>
          </select>
          <ChevronDown aria-hidden size={14} />
        </label>
        <a href="/api/health" target="_blank" rel="noreferrer">
          API
        </a>
        <button className="top-link" type="button" onClick={onOpenDocs}>
          Docs
        </button>
        {account.isConnected ? (
          <button className="account-button" type="button" onClick={() => disconnect()}>
            <Unplug aria-hidden size={15} />
            {account.address ? shortAddress(account.address) : 'Disconnect'}
          </button>
        ) : (
          <button
            className="account-button"
            type="button"
            disabled={isPending || !connectors[0]}
            onClick={() => connectors[0] && connect({ connector: connectors[0] })}
          >
            <Cable aria-hidden size={15} />
            {isPending ? 'Connecting…' : 'Connect wallet'}
          </button>
        )}
      </nav>
    </header>
  )
}

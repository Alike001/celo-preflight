import { useState } from 'react'
import { ArrowLeft, CheckCircle2, LoaderCircle, ShieldCheck, WalletCards } from 'lucide-react'
import { useAccount, useConnect, usePublicClient, useSwitchChain } from 'wagmi'
import {
  encodeFunctionData,
  formatUnits,
  hexToBigInt,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'
import {
  CELO_SEPOLIA_CHAIN_ID,
  CELO_SEPOLIA_USDC,
  FEE_CURRENCY_DIRECTORY,
  findLiveUsdcFeeCurrency,
  normalizedFeeToUsdcBaseUnits,
  parseRecipient,
  parseUsdcAmount,
  type ListedFeeCurrency,
} from '../fee-proof-utils.js'

const directoryAbi = parseAbi(['function getCurrencies() view returns (address[])'])
const adapterAbi = parseAbi([
  'function adaptedToken() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
])
const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
])

type Readiness = {
  recipient: Address
  amount: bigint
  feeCap: bigint
  feeCurrency: Address
  estimatedFee: bigint
  usdcBalance: bigint
}

function conciseAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected wallet or network error.'
}

export function FeeCurrencyProof() {
  const account = useAccount()
  const { connect, connectors, isPending: isConnecting } = useConnect()
  const publicClient = usePublicClient({ chainId: CELO_SEPOLIA_CHAIN_ID })
  const { switchChainAsync } = useSwitchChain()
  const [recipientInput, setRecipientInput] = useState('')
  const [amountInput, setAmountInput] = useState('0.01')
  const [feeCapInput, setFeeCapInput] = useState('0.01')
  const [readiness, setReadiness] = useState<Readiness>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function inspectLiveConditions(): Promise<Readiness> {
    if (!account.isConnected || !account.address) {
      throw new Error('Connect the dedicated Celo Sepolia MetaMask account first.')
    }
    if (!publicClient) throw new Error('Celo Sepolia RPC is unavailable. Try again shortly.')
    if (account.chainId !== CELO_SEPOLIA_CHAIN_ID) {
      await switchChainAsync({ chainId: CELO_SEPOLIA_CHAIN_ID })
    }
    if ((await publicClient.getChainId()) !== CELO_SEPOLIA_CHAIN_ID) {
      throw new Error('Celo Sepolia was not selected.')
    }

    const recipient = parseRecipient(recipientInput)
    if (recipient.toLowerCase() === account.address.toLowerCase()) {
      throw new Error('Recipient must be a different account.')
    }
    const amount = parseUsdcAmount(amountInput, 'Transfer amount')
    const feeCap = parseUsdcAmount(feeCapInput, 'Fee cap')
    const currencies = await publicClient.readContract({
      address: FEE_CURRENCY_DIRECTORY,
      abi: directoryAbi,
      functionName: 'getCurrencies',
    })
    const listed = await Promise.all(
      currencies.map(async (address) => {
        try {
          const adaptedToken = await publicClient.readContract({
            address,
            abi: adapterAbi,
            functionName: 'adaptedToken',
          })
          return { address, adaptedToken } as ListedFeeCurrency
        } catch {
          return { address } as ListedFeeCurrency
        }
      }),
    )
    const liveAdapter = findLiveUsdcFeeCurrency(listed)
    if (!liveAdapter?.adaptedToken) {
      throw new Error('Native Celo Sepolia USDC has no live allowlisted fee adapter.')
    }
    const feeCurrency = liveAdapter.address
    const feeGasPrice = hexToBigInt(
      (await publicClient.request({
        method: 'eth_gasPrice',
        params: [feeCurrency],
      } as never)) as Hex,
    )
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [recipient, amount],
    })
    const transaction = {
      account: account.address,
      to: CELO_SEPOLIA_USDC,
      data,
      feeCurrency,
      type: 'cip64' as const,
    }
    const [gas, usdcBalance, adapterBalance] = await Promise.all([
      publicClient.estimateGas(transaction as never),
      publicClient.readContract({
        address: CELO_SEPOLIA_USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      }),
      publicClient.readContract({
        address: feeCurrency,
        abi: adapterAbi,
        functionName: 'balanceOf',
        args: [account.address],
      }),
    ])
    const estimatedFee = normalizedFeeToUsdcBaseUnits(gas * feeGasPrice)
    if (estimatedFee > feeCap) {
      throw new Error(
        `Estimated fee ${formatUnits(estimatedFee, 6)} USDC exceeds your ${formatUnits(feeCap, 6)} USDC cap.`,
      )
    }
    if (usdcBalance < amount + estimatedFee || adapterBalance < gas * feeGasPrice) {
      throw new Error('The connected account cannot cover the transfer plus fee cap.')
    }
    return { recipient, amount, feeCap, feeCurrency, estimatedFee, usdcBalance }
  }

  async function check() {
    setBusy(true)
    setError(undefined)
    try {
      setReadiness(await inspectLiveConditions())
    } catch (nextError) {
      setReadiness(undefined)
      setError(messageFrom(nextError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="fee-proof-shell">
      <section className="fee-proof-card" aria-labelledby="fee-proof-title">
        <a className="fee-proof-back" href="/" aria-label="Back to Celo Preflight">
          <ArrowLeft aria-hidden size={15} /> Celo Preflight
        </a>
        <p className="eyebrow">TESTNET-ONLY · READ-ONLY WALLET CHECK</p>
        <h1 id="fee-proof-title">Celo Sepolia fee-currency readiness</h1>
        <p className="fee-proof-summary">
          Check the live USDC adapter, current Celo fee estimate, and your test balance. This page
          never receives a private key or asks MetaMask to sign a fee-currency transaction.
        </p>

        <div className="fee-proof-account">
          <WalletCards aria-hidden size={17} />
          {account.isConnected && account.address ? (
            <span>Connected: {conciseAddress(account.address)}</span>
          ) : (
            <button
              className="fee-proof-connect"
              type="button"
              disabled={isConnecting || !connectors[0]}
              onClick={() => connectors[0] && connect({ connector: connectors[0] })}
            >
              <WalletCards aria-hidden size={15} />
              {isConnecting ? 'Connecting MetaMask…' : 'Connect MetaMask'}
            </button>
          )}
        </div>

        <div className="fee-proof-grid">
          <label>
            Recipient
            <input
              value={recipientInput}
              onChange={(event) => {
                setRecipientInput(event.target.value)
                setReadiness(undefined)
              }}
              placeholder="0x…"
              spellCheck="false"
            />
          </label>
          <label>
            Transfer amount (USDC)
            <input
              value={amountInput}
              onChange={(event) => {
                setAmountInput(event.target.value)
                setReadiness(undefined)
              }}
              inputMode="decimal"
            />
          </label>
          <label>
            Maximum fee (USDC)
            <input
              value={feeCapInput}
              onChange={(event) => {
                setFeeCapInput(event.target.value)
                setReadiness(undefined)
              }}
              inputMode="decimal"
            />
          </label>
        </div>

        <button
          className="fee-proof-primary"
          type="button"
          onClick={() => void check()}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle className="spin" aria-hidden size={16} />
          ) : (
            <ShieldCheck aria-hidden size={16} />
          )}
          Check live conditions
        </button>

        {readiness ? (
          <div className="fee-proof-result" aria-live="polite">
            <strong>
              <CheckCircle2 aria-hidden size={16} /> Live conditions confirmed
            </strong>
            <dl>
              <div>
                <dt>Network</dt>
                <dd>Celo Sepolia · 11142220</dd>
              </div>
              <div>
                <dt>USDC adapter</dt>
                <dd>{conciseAddress(readiness.feeCurrency)} · live directory</dd>
              </div>
              <div>
                <dt>Estimated fee</dt>
                <dd>{formatUnits(readiness.estimatedFee, 6)} USDC</dd>
              </div>
              <div>
                <dt>Test USDC balance</dt>
                <dd>{formatUnits(readiness.usdcBalance, 6)} USDC</dd>
              </div>
            </dl>
            <p className="fee-proof-boundary">
              <strong>MetaMask limitation:</strong> MetaMask uses Celo’s Ethereum-compatible
              transaction format, which cannot include <code>feeCurrency</code>. It can pay test gas
              in CELO, but cannot prove a USDC-paid fee. No transaction will be requested here.
            </p>
          </div>
        ) : null}
        {error ? (
          <p className="fee-proof-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="fee-proof-footnote">
          No wallet connection happens automatically. Clicking “Check” is read-only. The Celo node
          supports fee abstraction; this screen truthfully separates that live capability from
          MetaMask’s wallet limitation.
        </p>
      </section>
    </main>
  )
}

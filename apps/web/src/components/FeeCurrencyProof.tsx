import { useState } from 'react'
import { ArrowLeft, CheckCircle2, LoaderCircle, ShieldCheck, WalletCards } from 'lucide-react'
import { useAccount, useConnect, usePublicClient, useSwitchChain } from 'wagmi'
import { getWalletClient } from 'wagmi/actions'
import {
  encodeFunctionData,
  formatUnits,
  hexToBigInt,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'
import { wagmiConfig } from '../wagmi.js'
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
  feeGasPrice: bigint
  gas: bigint
  estimatedFee: bigint
  usdcBalance: bigint
  adapterBalance: bigint
  data: Hex
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
  const [authorized, setAuthorized] = useState(false)
  const [busy, setBusy] = useState<'checking' | 'sending'>()
  const [error, setError] = useState<string>()
  const [transactionHash, setTransactionHash] = useState<Hex>()
  const [actualFee, setActualFee] = useState<bigint>()

  async function inspectLiveConditions(): Promise<Readiness> {
    if (!account.isConnected || !account.address) {
      throw new Error('Connect the dedicated Celo Sepolia MetaMask account first.')
    }
    if (!publicClient) throw new Error('Celo Sepolia RPC is unavailable. Try again shortly.')
    if (account.chainId !== CELO_SEPOLIA_CHAIN_ID) {
      await switchChainAsync({ chainId: CELO_SEPOLIA_CHAIN_ID })
    }
    const chainId = await publicClient.getChainId()
    if (chainId !== CELO_SEPOLIA_CHAIN_ID) throw new Error('Celo Sepolia was not selected.')

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
      throw new Error(
        'Native Celo Sepolia USDC has no live allowlisted fee adapter. No transaction sent.',
      )
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
      // wagmi's public-client generic omits Celo's CIP-64 extension even though the active
      // Celo Sepolia transport supports it. The wallet client below still sends the same typed
      // `cip64` request; this cast only bridges that upstream declaration gap.
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
        `Estimated fee ${formatUnits(estimatedFee, 6)} USDC exceeds your ${formatUnits(feeCap, 6)} USDC cap. No transaction sent.`,
      )
    }
    if (usdcBalance < amount + estimatedFee || adapterBalance < gas * feeGasPrice) {
      throw new Error(
        'The connected account cannot cover the transfer plus fee cap. No transaction sent.',
      )
    }
    return {
      recipient,
      amount,
      feeCap,
      feeCurrency,
      feeGasPrice,
      gas,
      estimatedFee,
      usdcBalance,
      adapterBalance,
      data,
    }
  }

  async function check() {
    setBusy('checking')
    setError(undefined)
    setTransactionHash(undefined)
    setActualFee(undefined)
    try {
      const next = await inspectLiveConditions()
      setReadiness(next)
    } catch (nextError) {
      setReadiness(undefined)
      setAuthorized(false)
      setError(messageFrom(nextError))
    } finally {
      setBusy(undefined)
    }
  }

  async function send() {
    if (!authorized) {
      setError('Tick the authorization statement before opening MetaMask.')
      return
    }
    if (!account.address || !publicClient) return
    setBusy('sending')
    setError(undefined)
    try {
      // Re-read the directory, balances, and gas immediately before requesting a signature.
      const latest = await inspectLiveConditions()
      const walletClient = await getWalletClient(wagmiConfig, {
        account: account.address,
        chainId: CELO_SEPOLIA_CHAIN_ID,
      })
      const hash = await walletClient.sendTransaction({
        account: account.address,
        to: CELO_SEPOLIA_USDC,
        data: latest.data,
        gas: latest.gas,
        maxFeePerGas: latest.feeGasPrice,
        feeCurrency: latest.feeCurrency,
        type: 'cip64',
      })
      setTransactionHash(hash)
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('The Celo Sepolia transaction reverted.')
      const adapterAfter = await publicClient.readContract({
        address: latest.feeCurrency,
        abi: adapterAbi,
        functionName: 'balanceOf',
        args: [account.address],
      })
      if (adapterAfter >= latest.adapterBalance) {
        throw new Error(
          'Receipt succeeded, but the USDC fee-balance decrease could not be confirmed.',
        )
      }
      setActualFee(normalizedFeeToUsdcBaseUnits(latest.adapterBalance - adapterAfter))
      setReadiness(latest)
    } catch (nextError) {
      setError(messageFrom(nextError))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <main className="fee-proof-shell">
      <section className="fee-proof-card" aria-labelledby="fee-proof-title">
        <a className="fee-proof-back" href="/" aria-label="Back to Celo Preflight">
          <ArrowLeft aria-hidden size={15} /> Celo Preflight
        </a>
        <p className="eyebrow">TESTNET-ONLY · METAMASK SIGNS LOCALLY</p>
        <h1 id="fee-proof-title">Celo Sepolia fee-currency proof</h1>
        <p className="fee-proof-summary">
          Transfer a capped amount of Circle test USDC while Celo charges the transaction fee in the
          same USDC. This page never receives a private key.
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
                setAuthorized(false)
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
                setAuthorized(false)
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
                setAuthorized(false)
              }}
              inputMode="decimal"
            />
          </label>
        </div>

        <button
          className="fee-proof-primary"
          type="button"
          onClick={() => void check()}
          disabled={busy !== undefined}
        >
          {busy === 'checking' ? (
            <LoaderCircle className="spin" aria-hidden size={16} />
          ) : (
            <ShieldCheck aria-hidden size={16} />
          )}
          Check live conditions
        </button>

        {readiness ? (
          <div className="fee-proof-result" aria-live="polite">
            <strong>
              <CheckCircle2 aria-hidden size={16} /> Ready for wallet review
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
            <label className="fee-proof-consent">
              <input
                type="checkbox"
                checked={authorized}
                onChange={(event) => setAuthorized(event.target.checked)}
              />
              <span>
                I authorize exactly {formatUnits(readiness.amount, 6)} test USDC to{' '}
                {conciseAddress(readiness.recipient)}, with a maximum fee of{' '}
                {formatUnits(readiness.feeCap, 6)} test USDC.
              </span>
            </label>
            <button
              className="fee-proof-primary"
              type="button"
              onClick={() => void send()}
              disabled={busy !== undefined || !authorized}
            >
              {busy === 'sending' ? (
                <LoaderCircle className="spin" aria-hidden size={16} />
              ) : (
                <WalletCards aria-hidden size={16} />
              )}
              Open MetaMask for the capped transaction
            </button>
          </div>
        ) : null}

        {transactionHash ? (
          <div className="fee-proof-success" aria-live="polite">
            <CheckCircle2 aria-hidden size={17} />
            <div>
              <strong>Receipt verified on Celo Sepolia</strong>
              <code>{transactionHash}</code>
              {actualFee !== undefined ? (
                <span>USDC fee charged: {formatUnits(actualFee, 6)} USDC</span>
              ) : null}
              <a
                href={`https://celo-sepolia.blockscout.com/tx/${transactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="fee-proof-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="fee-proof-footnote">
          No wallet connection happens automatically. Clicking “Check” is read-only. Only the final
          MetaMask confirmation can send one testnet transaction.
        </p>
      </section>
    </main>
  )
}

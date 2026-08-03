import { createRequire } from 'node:module'

// This is a root-level verification script, while viem is deliberately owned by the web workspace.
// Resolve it from that workspace instead of adding a second dependency/version at the repository root.
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { createPublicClient, http, parseAbi, parseAbiItem } = require('viem')

const forkUrl = process.env.FORK_RPC_URL ?? 'http://127.0.0.1:8547'
const preflightUrl = (
  process.env.PREFLIGHT_URL ?? 'https://celo-preflight-production.up.railway.app'
).replace(/\/$/, '')
const USDm = '0x765DE816845861e75A25fCA122bb6898B8B1282a'
const KESm = '0x456a3D042C0DbD3db53D5489e98dFb038553B0d0'
const amountIn = 1_000_000n // 1 USDm, expressed in the token's six decimal base units.
const transfer = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)
const erc20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isLocalFork(url) {
  try {
    return ['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

async function fetchJson(path, init) {
  const response = await fetch(`${preflightUrl}${path}`, init)
  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${path} failed (${response.status}): ${JSON.stringify(body)}`,
    )
  }
  return body
}

async function findFundedHolder(client, blockNumber) {
  // A recent transfer is enough to discover a holder; Anvil's local impersonation can safely use
  // either an EOA or contract account because this state is disposable. Start narrow so the public
  // fork provider is never asked for an unnecessarily expensive log range.
  for (const window of [50n, 250n, 1_000n]) {
    const fromBlock = blockNumber > window ? blockNumber - window : 0n
    const logs = await client.getLogs({
      address: USDm,
      event: transfer,
      fromBlock,
      toBlock: blockNumber,
    })
    const candidates = [
      ...new Set(logs.flatMap((log) => [log.args.from, log.args.to]).filter(Boolean)),
    ]
    for (const candidate of candidates) {
      const balance = await client.readContract({
        address: USDm,
        abi: erc20,
        functionName: 'balanceOf',
        args: [candidate],
      })
      if (balance >= amountIn) return candidate
    }
  }
  throw new Error('Could not find a funded USDm holder in the latest 1,000 forked Celo blocks.')
}

function hex(value) {
  return `0x${value.toString(16)}`
}

async function toRpcTransaction(client, draft) {
  // Anvil keeps the fork's EIP-1559 base fee. A draft built against an earlier
  // block can otherwise become underpriced after the approval is mined, leaving
  // the local swap pending forever. Read fees immediately before each local send.
  const [block, fees] = await Promise.all([client.getBlock(), client.estimateFeesPerGas()])
  const priorityFee = fees.maxPriorityFeePerGas ?? 1_000_000_000n
  const minimumMaxFee = (block.baseFeePerGas ?? 0n) * 2n + priorityFee
  const maxFeePerGas = [fees.maxFeePerGas ?? 0n, minimumMaxFee].reduce((highest, candidate) =>
    candidate > highest ? candidate : highest,
  )

  return {
    from: draft.from,
    to: draft.to,
    data: draft.data,
    value: hex(BigInt(draft.valueWei)),
    gas: '0x7a120',
    maxFeePerGas: hex(maxFeePerGas),
    maxPriorityFeePerGas: hex(priorityFee),
  }
}

assert(
  isLocalFork(forkUrl),
  'FORK_RPC_URL must point to localhost. This verifier intentionally refuses to send to a remote RPC.',
)

const client = createPublicClient({ transport: http(forkUrl) })
const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()])
assert(chainId === 42220, `Fork must use Celo Mainnet chain ID 42220; received ${chainId}.`)
const owner = await findFundedHolder(client, blockNumber)

// This changes only the local Anvil fork: it makes a public Celo account payable for local gas.
await client.request({ method: 'anvil_setBalance', params: [owner, '0x3635C9ADC5DEA00000'] })

// The product builds these unsigned drafts from current Celo/Mento state. It does not send either one.
const proposal = await fetchJson('/api/mento/live-usdm-kesm-proposal', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ owner, amountInWei: amountIn.toString() }),
})
assert(proposal.quote?.tradable === true, 'Mento returned a non-tradable route.')
assert(proposal.approval, 'Expected a bounded USDm approval draft.')

const before = await Promise.all([
  client.readContract({ address: USDm, abi: erc20, functionName: 'balanceOf', args: [owner] }),
  client.readContract({ address: KESm, abi: erc20, functionName: 'balanceOf', args: [owner] }),
])

const approvalHash = await client.request({
  method: 'eth_sendTransaction',
  params: [await toRpcTransaction(client, proposal.approval)],
})
const approvalReceipt = await client.waitForTransactionReceipt({ hash: approvalHash })
assert(approvalReceipt.status === 'success', 'The local-fork USDm approval reverted.')
const allowance = await client.readContract({
  address: USDm,
  abi: erc20,
  functionName: 'allowance',
  args: [owner, proposal.transaction.to],
})
assert(allowance >= amountIn, 'The local-fork approval did not grant the quoted input amount.')

const swapHash = await client.request({
  method: 'eth_sendTransaction',
  params: [await toRpcTransaction(client, proposal.transaction)],
})
const swapReceipt = await client.waitForTransactionReceipt({ hash: swapHash })
assert(swapReceipt.status === 'success', 'The local-fork Mento swap reverted.')
const after = await Promise.all([
  client.readContract({ address: USDm, abi: erc20, functionName: 'balanceOf', args: [owner] }),
  client.readContract({ address: KESm, abi: erc20, functionName: 'balanceOf', args: [owner] }),
])
assert(
  before[0] - after[0] === amountIn,
  'The local-fork USDm debit differs from the quoted input.',
)
assert(after[1] > before[1], 'The local-fork KESm balance did not increase.')

console.log(
  JSON.stringify(
    {
      status: 'ok',
      environment: 'local Anvil fork only',
      remoteWrites: 'none',
      localTransactions: [approvalHash, swapHash],
      forkBlock: blockNumber.toString(),
      owner,
      amountIn: amountIn.toString(),
      expectedAmountOut: proposal.quote.expectedAmountOut,
      minimumAmountOut: proposal.quote.minimumAmountOut,
      actualAmountOut: (after[1] - before[1]).toString(),
      attribution: 'Celo ERC-8021 suffix retained in both locally executed drafts',
      limitation:
        'This proves Mento contract execution on a local Celo state fork. It does not prove Celo node fee-currency transaction execution.',
    },
    null,
    2,
  ),
)

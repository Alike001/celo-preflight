import { decodeFunctionData, parseAbi, parseAbiItem } from 'viem'
import type { Address, Hex, PaymentReceipt, PreparedReport } from '@preflight/shared'
import type { ReportRepository } from './report-store.js'

export const NETWORK = 'eip155:42220'
export const CELO_USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C'

const eip3009Abi = parseAbi([
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
])
const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)

interface Eip3009Authorization {
  from: Address
  to: Address
  value: string
  nonce: Hex
}

export interface RecoveryClient {
  readContract(args: unknown): Promise<unknown>
  getBlockNumber(): Promise<bigint>
  getLogs(args: unknown): Promise<Array<{ args?: { value?: bigint }; transactionHash?: Hex }>>
  getTransaction(args: unknown): Promise<{ input: Hex; to?: Address; blockNumber?: bigint | null }>
  getTransactionReceipt(
    args: unknown,
  ): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint }>
  getBlock(args: unknown): Promise<{ timestamp: bigint }>
}

function eip3009Authorization(payload: unknown): Eip3009Authorization | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const authorization = (payload as { authorization?: unknown }).authorization
  if (!authorization || typeof authorization !== 'object') return undefined
  const value = authorization as Record<string, unknown>
  if (
    typeof value.from !== 'string' ||
    typeof value.to !== 'string' ||
    typeof value.value !== 'string' ||
    typeof value.nonce !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(value.from) ||
    !/^0x[0-9a-fA-F]{40}$/.test(value.to) ||
    !/^\d+$/.test(value.value) ||
    !/^0x[0-9a-fA-F]{64}$/.test(value.nonce)
  ) {
    return undefined
  }
  return {
    from: value.from as Address,
    to: value.to as Address,
    value: value.value,
    nonce: value.nonce as Hex,
  }
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

export async function reconcileEip3009Settlement(
  client: RecoveryClient,
  input: { payload: unknown; asset: Address; payTo: Address; amount: string },
): Promise<{ transactionHash: Hex; payer: Address } | undefined> {
  const authorization = eip3009Authorization(input.payload)
  if (
    !authorization ||
    authorization.to.toLowerCase() !== input.payTo.toLowerCase() ||
    authorization.value !== input.amount
  ) {
    return undefined
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const used = await client.readContract({
        address: input.asset,
        abi: eip3009Abi,
        functionName: 'authorizationState',
        args: [authorization.from, authorization.nonce],
      })
      if (used === true) {
        const latestBlock = await client.getBlockNumber()
        const fromBlock = latestBlock > 600n ? latestBlock - 600n : 0n
        const transfers = await client.getLogs({
          address: input.asset,
          event: transferEvent,
          args: { from: authorization.from, to: authorization.to },
          fromBlock,
          toBlock: latestBlock,
        })
        for (const transfer of transfers) {
          if (transfer.args?.value?.toString() !== authorization.value || !transfer.transactionHash)
            continue
          const transaction = await client.getTransaction({ hash: transfer.transactionHash })
          if (transaction.to?.toLowerCase() !== input.asset.toLowerCase()) continue
          const decoded = decodeFunctionData({ abi: eip3009Abi, data: transaction.input })
          if (
            decoded.functionName === 'transferWithAuthorization' &&
            decoded.args[0]?.toLowerCase() === authorization.from.toLowerCase() &&
            decoded.args[1]?.toLowerCase() === authorization.to.toLowerCase() &&
            decoded.args[2]?.toString() === authorization.value &&
            decoded.args[5]?.toLowerCase() === authorization.nonce.toLowerCase()
          ) {
            return { transactionHash: transfer.transactionHash, payer: authorization.from }
          }
        }
      }
    } catch {
      // A reconciliation failure must never turn an unknown settlement into success.
    }
    if (attempt < 5) await wait(1_000)
  }
  return undefined
}

export async function recoverHistoricCeloClaim(
  client: RecoveryClient,
  reports: ReportRepository,
  input: { reportId: string; transactionHash: Hex; payTo: Address; amount: string },
): Promise<PreparedReport | undefined> {
  const report = reports.get(input.reportId)
  if (!report || report.payment || reports.hasPaymentTransaction(input.transactionHash))
    return undefined
  try {
    const [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash: input.transactionHash }),
      client.getTransactionReceipt({ hash: input.transactionHash }),
    ])
    if (receipt.status !== 'success' || transaction.to?.toLowerCase() !== CELO_USDC.toLowerCase()) {
      return undefined
    }
    const decoded = decodeFunctionData({ abi: eip3009Abi, data: transaction.input })
    if (
      decoded.functionName !== 'transferWithAuthorization' ||
      decoded.args[1]?.toLowerCase() !== input.payTo.toLowerCase() ||
      decoded.args[2]?.toString() !== input.amount
    ) {
      return undefined
    }
    const block = await client.getBlock({ blockNumber: receipt.blockNumber })
    const settledAt = new Date(Number(block.timestamp) * 1_000)
    if (
      settledAt.getTime() < new Date(report.createdAt).getTime() ||
      settledAt.getTime() > new Date(report.expiresAt).getTime()
    ) {
      return undefined
    }
    return reports.attachPayment(report.id, {
      network: NETWORK,
      transactionHash: input.transactionHash,
      payer: decoded.args[0] as Address,
      payTo: input.payTo,
      amount: input.amount,
      asset: CELO_USDC,
      settledAt: settledAt.toISOString(),
    })
  } catch {
    // A historic repair must be just as strict as a live claim: absent proof means no receipt.
    return undefined
  }
}

export function paymentReceipt(
  transactionHash: Hex,
  payer: Address,
  payTo: Address,
  amount: string,
  settledAt = new Date().toISOString(),
): PaymentReceipt {
  return { network: NETWORK, transactionHash, payer, payTo, amount, asset: CELO_USDC, settledAt }
}

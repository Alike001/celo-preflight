import { createRequire } from 'node:module'
import { fromDataSuffix } from '@celo/attribution-tags'
import type { Mento as MentoClient } from '@mento-protocol/mento-sdk'
import { parseAbi, type PublicClient } from 'viem'
import type { Address, InspectionFacts, SimulationFact, TransactionDraft } from '@preflight/shared'
import { decodeTransaction, FEE_CURRENCY_DIRECTORY, mentoRouterAbi } from '@preflight/engine'
import { createChainClient } from './chain-client.js'
import type { CeloPublicClient } from './chain-client.js'
import { errorMessage, HttpError } from './errors.js'
import type { ApiConfig } from './config.js'

const feeCurrencyDirectoryAbi = parseAbi(['function getCurrencies() view returns (address[])'])
const require = createRequire(import.meta.url)
// The inspected 3.3 beta ESM bundle omits extension suffixes; its documented CJS export is valid.
const { Mento } = require('@mento-protocol/mento-sdk') as { Mento: typeof MentoClient }

function isRevert(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return ['revert', 'invalid opcode', 'insufficient funds', 'execution error'].some((term) =>
    message.includes(term),
  )
}

async function simulate(
  client: CeloPublicClient,
  transaction: TransactionDraft,
  blockNumber: bigint,
): Promise<SimulationFact> {
  const request = {
    account: transaction.from,
    to: transaction.to,
    data: transaction.data,
    value: BigInt(transaction.valueWei),
    blockNumber,
  } as const
  try {
    const result = await client.call(request)
    let gasEstimate: string | undefined
    try {
      gasEstimate = (await client.estimateGas(request)).toString()
    } catch {
      gasEstimate = undefined
    }
    return {
      status: 'success',
      ...(gasEstimate ? { gasEstimate } : {}),
      ...(result.data ? { returnData: result.data } : {}),
    }
  } catch (error) {
    return {
      status: isRevert(error) ? 'revert' : 'unavailable',
      error: errorMessage(error),
    }
  }
}

async function feeCurrencyAllowed(
  client: CeloPublicClient,
  feeCurrency: Address | undefined,
  blockNumber: bigint,
): Promise<boolean | undefined> {
  if (!feeCurrency) return undefined
  try {
    const currencies = await client.readContract({
      address: FEE_CURRENCY_DIRECTORY,
      abi: feeCurrencyDirectoryAbi,
      functionName: 'getCurrencies',
      blockNumber,
    })
    return currencies.some((currency) => currency.toLowerCase() === feeCurrency.toLowerCase())
  } catch {
    return undefined
  }
}

async function enrichMento(
  client: CeloPublicClient,
  facts: InspectionFacts,
  blockNumber: bigint,
): Promise<void> {
  if (facts.decoded.kind !== 'mento-swap') return
  const decoded = facts.decoded
  try {
    const amounts = await client.readContract({
      address: decoded.router,
      abi: mentoRouterAbi,
      functionName: 'getAmountsOut',
      args: [BigInt(decoded.amountIn), decoded.routes],
      blockNumber,
    })
    const quotedAmountOut = amounts.at(-1)
    if (quotedAmountOut !== undefined) decoded.quotedAmountOut = quotedAmountOut.toString()
  } catch {
    delete decoded.quotedAmountOut
  }

  try {
    const tokenIn = decoded.routes[0]?.from
    const tokenOut = decoded.routes.at(-1)?.to
    if (!tokenIn || !tokenOut) return
    // The SDK accepts a generic viem client; Celo's chain formatter is a runtime-compatible extension.
    const mento = await Mento.create(facts.transaction.chainId, client as unknown as PublicClient)
    const route = await mento.routes.findRoute(tokenIn, tokenOut)
    const matchesDecodedRoute =
      route.path.length === decoded.routes.length &&
      route.path.every(
        (pool, index) =>
          pool.factoryAddr.toLowerCase() === decoded.routes[index]?.factory.toLowerCase(),
      )
    if (matchesDecodedRoute) decoded.tradable = await mento.trading.isRouteTradable(route)
    const evidenceBlock = await client.getBlockNumber()
    facts.snapshot.evidenceBlocks = { mentoTradability: evidenceBlock.toString() }
    facts.snapshot.stateNote =
      evidenceBlock === blockNumber
        ? 'All evidence was read at one block.'
        : 'Simulation, quote, and fee-currency evidence use the snapshot block; Mento tradability uses the separately recorded evidence block.'
  } catch {
    delete decoded.tradable
  }
}

export class ChainInspector {
  constructor(private readonly config: ApiConfig) {}

  async inspect(transaction: TransactionDraft): Promise<InspectionFacts> {
    const client = createChainClient(transaction.chainId, this.config.rpcUrls[transaction.chainId])
    let block
    try {
      block = await client.getBlock({ blockTag: 'latest' })
    } catch (error) {
      throw new HttpError(503, 'Celo RPC is unavailable.', errorMessage(error))
    }
    if (block.number === null) {
      throw new HttpError(503, 'Celo RPC returned a pending block without a block number.')
    }
    const simulation = await simulate(client, transaction, block.number)
    if (simulation.status === 'unavailable') {
      throw new HttpError(503, 'Celo RPC could not simulate this transaction.', simulation.error)
    }
    const parsedAttribution = fromDataSuffix(transaction.data)
    const facts: InspectionFacts = {
      transaction,
      snapshot: {
        blockNumber: block.number.toString(),
        ...(block.hash ? { blockHash: block.hash } : {}),
        observedAt: Number(block.timestamp),
        stateNote: 'All available evidence uses the snapshot block.',
      },
      simulation,
      decoded: decodeTransaction(transaction),
      attributionCodes: parsedAttribution?.codes ?? [],
    }
    const allowed = await feeCurrencyAllowed(client, transaction.feeCurrency, block.number)
    if (allowed !== undefined) facts.feeCurrencyAllowed = allowed
    await enrichMento(client, facts, block.number)
    return facts
  }
}

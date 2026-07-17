import { createPublicClient, http } from 'viem'
import { celo, celoSepolia } from 'viem/chains'
import type { SupportedChainId } from '@preflight/shared'

export type CeloPublicClient = ReturnType<typeof createPublicClient>

export function createChainClient(chainId: SupportedChainId, rpcUrl: string): CeloPublicClient {
  const chain = chainId === 42220 ? celo : celoSepolia
  return createPublicClient({
    chain,
    transport: http(rpcUrl, { timeout: 12_000 }),
  }) as unknown as CeloPublicClient
}

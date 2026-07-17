import type { Address, SupportedChainId } from '@preflight/shared'

export const RULESET_VERSION = 'celo-preflight/1.0.0'
export const MAX_UINT256 = (2n ** 256n - 1n).toString()

export const MENTO_ROUTERS: Record<SupportedChainId, Address> = {
  42220: '0x4861840C2EfB2b98312B0aE34d86fD73E8f9B6f6',
  11142220: '0xcf6cD45210b3ffE3cA28379C4683F1e60D0C2CCd',
}

export const FEE_CURRENCY_DIRECTORY = '0x9212Fb72ae65367A7c887eC4Ad9bE310BAC611BF'

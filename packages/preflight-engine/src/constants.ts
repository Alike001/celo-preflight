import type { Address, SupportedChainId } from '@preflight/shared'

export const RULESET_VERSION = 'celo-preflight/1.0.0'
export const MAX_UINT256 = (2n ** 256n - 1n).toString()

export const MENTO_ROUTERS: Record<SupportedChainId, Address> = {
  42220: '0x4861840C2EfB2b98312B0aE34d86fD73E8f9B6f6',
  11142220: '0xcf6cD45210b3ffE3cA28379C4683F1e60D0C2CCd',
}

/**
 * FeeCurrencyDirectory is deployed separately on Celo Mainnet and Celo Sepolia.
 * Do not reuse the Sepolia address on Mainnet: a failed read must remain a WARN,
 * never become an assumed allowlist result.
 */
export const FEE_CURRENCY_DIRECTORIES: Record<SupportedChainId, Address> = {
  42220: '0x15F344b9E6c3Cb6F0376A36A64928b13F62C6276',
  11142220: '0x9212Fb72ae65367A7c887eC4Ad9bE310BAC611BF',
}

// This is deliberately a small, explicit registry rather than an inference from
// a four-byte selector. A contract can expose `transfer`/`approve` without being
// the token a signer believes it is. Unknown token targets remain inspectable,
// but cannot receive a CLEAR verdict.
export const VERIFIED_ERC20_TOKENS: Partial<Record<SupportedChainId, readonly Address[]>> = {
  42220: [
    '0x765DE816845861e75A25fCA122bb6898B8B1282a', // USDm
    '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', // native Celo USDC
  ],
  // Celo Sepolia's current USDC token as verified through its live FeeCurrencyDirectory adapter.
  11142220: ['0x01C5C0122039549AD1493B8220cABEdD739BC44E'],
}

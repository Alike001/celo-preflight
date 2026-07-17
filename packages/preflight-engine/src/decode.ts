import { decodeFunctionData, parseAbi } from 'viem'
import type { Address, DecodedCall, TransactionDraft } from '@preflight/shared'
import { MENTO_ROUTERS } from './constants.js'

const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address recipient, uint256 amount) returns (bool)',
])

const mentoRouterAbi = parseAbi([
  'struct Route { address from; address to; address factory; }',
  'function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, Route[] routes, address to, uint256 deadline) returns (uint256[] amounts)',
])

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function decodeMento(transaction: TransactionDraft): DecodedCall | undefined {
  if (!sameAddress(transaction.to, MENTO_ROUTERS[transaction.chainId])) return undefined

  try {
    const decoded = decodeFunctionData({
      abi: mentoRouterAbi,
      data: transaction.data,
    })
    if (decoded.functionName !== 'swapExactTokensForTokens') return undefined
    const [amountIn, amountOutMin, routes, recipient, deadline] = decoded.args
    return {
      kind: 'mento-swap',
      router: transaction.to,
      amountIn: amountIn.toString(),
      amountOutMin: amountOutMin.toString(),
      routes: routes.map((route) => ({
        from: route.from,
        to: route.to,
        factory: route.factory,
      })),
      recipient,
      deadline: deadline.toString(),
    }
  } catch {
    return undefined
  }
}

function decodeErc20(transaction: TransactionDraft): DecodedCall | undefined {
  try {
    const decoded = decodeFunctionData({
      abi: erc20Abi,
      data: transaction.data,
    })
    if (decoded.functionName === 'approve') {
      const [spender, amount] = decoded.args
      return {
        kind: 'erc20-approve',
        token: transaction.to,
        spender,
        amount: amount.toString(),
      }
    }
    const [recipient, amount] = decoded.args
    return {
      kind: 'erc20-transfer',
      token: transaction.to,
      recipient,
      amount: amount.toString(),
    }
  } catch {
    return undefined
  }
}

export function decodeTransaction(transaction: TransactionDraft): DecodedCall {
  if (transaction.data === '0x') {
    return {
      kind: 'native-transfer',
      recipient: transaction.to,
      amount: transaction.valueWei,
    }
  }

  const decoded = decodeMento(transaction) ?? decodeErc20(transaction)
  if (decoded) return decoded

  return {
    kind: 'unknown',
    selector: transaction.data.slice(0, 10) as `0x${string}`,
    reason: sameAddress(transaction.to, MENTO_ROUTERS[transaction.chainId])
      ? 'Mento Router call is not supported by this ruleset'
      : 'Contract call selector is not supported by this ruleset',
  }
}

export { mentoRouterAbi }

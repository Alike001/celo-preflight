import { createRequire } from 'node:module'

// viem is deliberately owned by the web workspace; reuse that pinned version rather than adding a
// second root dependency solely for this optional verifier.
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  http,
  isAddress,
  parseAbi,
} = require('viem')
const { celoSepolia } = require('viem/chains')
const { privateKeyToAccount } = require('viem/accounts')

const RPC_URL =
  process.env.CELO_SEPOLIA_FEE_TEST_RPC_URL ?? 'https://forno.celo-sepolia.celo-testnet.org'
const DOCUMENTED_USDC_TOKEN = '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B'
const DOCUMENTED_USDC_ADAPTER = '0x4822e58de6f5e485eF90df51C41CE01721331dC0'
const TOKEN_CONTRACTS_USDC = '0x01C5C0122039549AD1493B8220cABEdD739BC44E'
const FEE_CURRENCY_DIRECTORY = '0x9212Fb72ae65367A7c887eC4Ad9bE310BAC611BF'
const NORMALIZED_TO_USDC = 10n ** 12n
const isBroadcast = process.argv.includes('--broadcast')

const directoryAbi = parseAbi(['function getCurrencies() view returns (address[])'])
const adapterAbi = parseAbi([
  'function adaptedToken() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
])
const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function addressFromEnv(name, required) {
  const value = process.env[name]
  if (!value && !required) return undefined
  assert(value && isAddress(value), `${name} must be a 20-byte hex address.`)
  return getAddress(value)
}

function positiveIntegerFromEnv(name, required) {
  const value = process.env[name]
  if (!value && !required) return undefined
  assert(value && /^\d+$/.test(value) && BigInt(value) > 0n, `${name} must be a positive integer.`)
  return BigInt(value)
}

function toUsdcUnits(normalizedAmount) {
  return (normalizedAmount + NORMALIZED_TO_USDC - 1n) / NORMALIZED_TO_USDC
}

const publicClient = createPublicClient({ chain: celoSepolia, transport: http(RPC_URL) })
const chainId = await publicClient.getChainId()
assert(chainId === 11142220, `Expected Celo Sepolia (11142220), received chain ID ${chainId}.`)

const [blockNumber, currencies] = await Promise.all([
  publicClient.getBlockNumber(),
  publicClient.readContract({
    address: FEE_CURRENCY_DIRECTORY,
    abi: directoryAbi,
    functionName: 'getCurrencies',
  }),
])
const listedCurrencies = await Promise.all(
  currencies.map(async (currency) => {
    try {
      const adaptedToken = await publicClient.readContract({
        address: currency,
        abi: adapterAbi,
        functionName: 'adaptedToken',
      })
      return { address: currency, adaptedToken }
    } catch {
      return { address: currency }
    }
  }),
)
// Celo's live directory is the source of truth. The official fee-abstraction page has at times
// lagged the deployed Celo Sepolia USDC adapter/token pair, so do not hardcode it into a sender.
const liveFeeAdapter = listedCurrencies.find(
  (currency) =>
    currency.adaptedToken !== undefined &&
    [DOCUMENTED_USDC_TOKEN, TOKEN_CONTRACTS_USDC].some(
      (token) => token.toLowerCase() === currency.adaptedToken.toLowerCase(),
    ),
)
const feeCurrency = liveFeeAdapter?.address
const feeToken = liveFeeAdapter?.adaptedToken
const feeGasPrice = feeCurrency
  ? hexToBigInt(await publicClient.request({ method: 'eth_gasPrice', params: [feeCurrency] }))
  : undefined

const configuredAddress = addressFromEnv('CELO_SEPOLIA_FEE_TEST_ADDRESS', false)
const readOnly = {
  status: feeCurrency ? 'ok' : 'unavailable',
  mode: isBroadcast ? 'broadcast-requested' : 'read-only',
  chainId,
  blockNumber: blockNumber.toString(),
  feeCurrencyDirectory: FEE_CURRENCY_DIRECTORY,
  documentedUsdcToken: DOCUMENTED_USDC_TOKEN,
  documentedUsdcAdapter: DOCUMENTED_USDC_ADAPTER,
  tokenContractsUsdc: TOKEN_CONTRACTS_USDC,
  feeCurrency: feeCurrency ?? null,
  adaptedToken: feeToken ?? null,
  feeGasPriceNormalized: feeGasPrice?.toString() ?? null,
  listedFeeCurrencies: listedCurrencies,
  estimatedTransaction: 'ERC-20 USDC transfer using CIP-64 type 0x7b and USDC adapter fee currency',
  writes: 'none',
}

if (!isBroadcast) {
  const balances =
    configuredAddress && feeToken
      ? await Promise.all([
          publicClient.readContract({
            address: feeToken,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [configuredAddress],
          }),
          feeCurrency
            ? publicClient.readContract({
                address: feeCurrency,
                abi: adapterAbi,
                functionName: 'balanceOf',
                args: [configuredAddress],
              })
            : Promise.resolve(undefined),
        ])
      : undefined
  console.log(
    JSON.stringify(
      {
        ...readOnly,
        ...(configuredAddress && balances
          ? {
              account: configuredAddress,
              usdcBalance: balances[0].toString(),
              adapterNormalizedBalance: balances[1]?.toString() ?? null,
            }
          : {}),
        next: feeCurrency
          ? 'To broadcast a testnet proof, provide a dedicated testnet key, a different testnet recipient, explicit USDC transfer and fee caps, then rerun with --broadcast. This command will never broadcast by default.'
          : 'No live adapter-backed fee currency is currently allowlisted. Do not broadcast; use this output to update the integration only after live directory state and official Celo documentation agree.',
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

// Broadcasting is deliberately opt-in and requires an explicit positive transfer and cap. Never
// point these variables at a Mainnet key: the chain-id assertion above fails closed before signing.
const privateKey = process.env.CELO_SEPOLIA_FEE_TEST_PRIVATE_KEY
assert(
  feeCurrency && feeToken && feeGasPrice !== undefined,
  'No live adapter-backed fee currency is currently allowlisted.',
)
assert(
  privateKey && /^0x[0-9a-fA-F]{64}$/.test(privateKey),
  'Set a dedicated Celo Sepolia private key.',
)
const account = privateKeyToAccount(privateKey)
const recipient = addressFromEnv('CELO_SEPOLIA_FEE_TEST_RECIPIENT', true)
const amount = positiveIntegerFromEnv('CELO_SEPOLIA_FEE_TEST_USDC_AMOUNT', true)
const maxFeeUsdc = positiveIntegerFromEnv('CELO_SEPOLIA_FEE_TEST_MAX_FEE_USDC', true)
assert(
  recipient.toLowerCase() !== account.address.toLowerCase(),
  'Recipient must differ from payer.',
)
if (configuredAddress) {
  assert(
    configuredAddress.toLowerCase() === account.address.toLowerCase(),
    'CELO_SEPOLIA_FEE_TEST_ADDRESS must match the supplied testnet private key.',
  )
}

const data = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'transfer',
  args: [recipient, amount],
})
const transaction = {
  account: account.address,
  to: feeToken,
  data,
  feeCurrency,
}
const [gas, usdcBefore, adapterBefore] = await Promise.all([
  publicClient.estimateGas(transaction),
  publicClient.readContract({
    address: feeToken,
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
const maximumFeeNormalized = gas * feeGasPrice
const maximumFeeUsdc = toUsdcUnits(maximumFeeNormalized)
assert(
  maximumFeeUsdc <= maxFeeUsdc,
  `Estimated maximum fee ${maximumFeeUsdc} USDC base units exceeds cap ${maxFeeUsdc}.`,
)
assert(
  usdcBefore >= amount + maximumFeeUsdc,
  'USDC balance cannot cover the transfer plus maximum fee.',
)
assert(
  adapterBefore >= maximumFeeNormalized,
  'Adapter-normalized USDC balance cannot cover maximum fee.',
)

// Forno intentionally does not expose `eth_sendTransaction`; a local account must sign the
// Celo-formatted CIP-64 envelope first, then submit only its raw signed bytes. Passing the address
// as the action account would instead make viem ask the RPC to sign, so keep the local account on
// the client and omit `account` from the signing request.
const signer = createWalletClient({ account, chain: celoSepolia, transport: http(RPC_URL) })
const nonce = await publicClient.getTransactionCount({
  address: account.address,
  blockTag: 'pending',
})
const serializedTransaction = await signer.signTransaction({
  to: feeToken,
  data,
  feeCurrency,
  gas,
  maxFeePerGas: feeGasPrice,
  // Celo Sepolia's current USDC adapter rejects a zero priority fee. One normalized unit is the
  // protocol minimum and remains far below the separately enforced USDC fee cap.
  maxPriorityFeePerGas: 1n,
  nonce,
})
assert(
  serializedTransaction.startsWith('0x7b'),
  'Expected a locally signed Celo CIP-64 (0x7b) transaction envelope.',
)
const hash = await publicClient.sendRawTransaction({ serializedTransaction })
const receipt = await publicClient.waitForTransactionReceipt({ hash })
assert(receipt.status === 'success', 'Celo Sepolia fee-currency transaction reverted.')
const [usdcAfter, adapterAfter] = await Promise.all([
  publicClient.readContract({
    address: feeToken,
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
assert(
  usdcBefore - usdcAfter >= amount,
  'USDC payer balance did not decrease by the transfer amount.',
)
assert(
  adapterBefore > adapterAfter,
  'Adapter-normalized USDC balance did not decrease for the fee.',
)

console.log(
  JSON.stringify(
    {
      ...readOnly,
      status: 'proved-on-celo-sepolia',
      writes: 'one explicitly authorized testnet transaction',
      payer: account.address,
      recipient,
      transactionHash: hash,
      gas: gas.toString(),
      usdcTransferBaseUnits: amount.toString(),
      maxFeeUsdcBaseUnits: maxFeeUsdc.toString(),
      actualFeeUsdcBaseUnits: toUsdcUnits(adapterBefore - adapterAfter).toString(),
      receiptStatus: receipt.status,
    },
    null,
    2,
  ),
)

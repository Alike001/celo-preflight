export type Address = `0x${string}`
export type Hex = `0x${string}`
export type SupportedChainId = 42220 | 11142220
export type Verdict = 'CLEAR' | 'CAUTION' | 'BLOCK'
export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'NOT_APPLICABLE'

export interface TransactionDraft {
  chainId: SupportedChainId
  from: Address
  to: Address
  valueWei: string
  data: Hex
  feeCurrency?: Address
}

export interface Snapshot {
  blockNumber: string
  blockHash?: Hex
  observedAt: number
  evidenceBlocks?: Record<string, string>
  stateNote?: string
}

export interface SimulationFact {
  status: 'success' | 'revert' | 'unavailable'
  gasEstimate?: string
  returnData?: Hex
  error?: string
}

export interface MentoRoute {
  from: Address
  to: Address
  factory: Address
}

export type DecodedCall =
  | { kind: 'native-transfer'; recipient: Address; amount: string }
  | {
      kind: 'erc20-transfer'
      token: Address
      recipient: Address
      amount: string
    }
  | { kind: 'erc20-approve'; token: Address; spender: Address; amount: string }
  | {
      kind: 'mento-swap'
      router: Address
      amountIn: string
      amountOutMin: string
      routes: MentoRoute[]
      recipient: Address
      deadline: string
      quotedAmountOut?: string
      tradable?: boolean
    }
  | { kind: 'unknown'; selector: Hex; reason: string }

export interface InspectionFacts {
  transaction: TransactionDraft
  snapshot: Snapshot
  simulation: SimulationFact
  decoded: DecodedCall
  feeCurrencyAllowed?: boolean
  attributionCodes: string[]
}

export interface CheckEvidence {
  id: string
  title: string
  status: CheckStatus
  summary: string
  details: Record<string, string | boolean | number | string[]>
}

export interface PreparedReport {
  id: string
  requestHash: Hex
  rulesetVersion: string
  verdict: Verdict
  createdAt: string
  expiresAt: string
  issuer: Address
  facts: InspectionFacts
  checks: CheckEvidence[]
  signature?: Hex
  payment?: PaymentReceipt
}

export interface PaymentReceipt {
  network: string
  transactionHash: Hex
  payer?: Address
  payTo: Address
  amount: string
  asset: Address
  settledAt: string
}

export interface PrepareResponse {
  mode: 'local-free' | 'hosted-paid'
  claimRequired: boolean
  prepared: Pick<
    PreparedReport,
    'id' | 'requestHash' | 'rulesetVersion' | 'verdict' | 'createdAt' | 'expiresAt' | 'issuer'
  >
  report?: PreparedReport
}

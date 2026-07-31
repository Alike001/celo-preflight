import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PreparedReport } from '@preflight/shared'
import type { PaymentCapability } from './payment-layer.js'

export function reportSummary(report: PreparedReport) {
  return {
    id: report.id,
    requestHash: report.requestHash,
    rulesetVersion: report.rulesetVersion,
    verdict: report.verdict,
    createdAt: report.createdAt,
    expiresAt: report.expiresAt,
    issuer: report.issuer,
    chainId: report.facts.transaction.chainId,
    to: report.facts.transaction.to,
    paid: Boolean(report.payment),
  }
}

export function webDistDirectory(): string | undefined {
  const configured = process.env.WEB_DIST_DIR
  const bundled = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
  const directory = configured ?? bundled
  return existsSync(resolve(directory, 'index.html')) ? directory : undefined
}

export function agentQuickstart(payment: PaymentCapability): string {
  const claimStep = payment.enabled
    ? `3. In hosted mode, \`prepare\` returns an unsigned evidence preview (facts and checks) plus \`prepared.id\`; it has no report signature or settlement receipt. Claim the fresh report through \`POST /api/preflight/claim\` with an x402 v2 exact client on ${payment.network}. The current price is ${payment.price} native Celo USDC. Send \`{ "reportId": prepared.id }\` as JSON. A successful response contains the signed report and its facilitator receipt.`
    : `3. This deployment is in local-free mode, so \`prepare\` directly returns the signed report. Check \`/api/capabilities\` before assuming that behavior in another deployment.`
  return `# Celo Preflight agent integration

Celo Preflight is a deterministic pre-sign gate for Celo transactions. Call it **before** your agent asks a wallet to sign a transfer, ERC-20 approval, Mento proposal, or fee-currency transaction. It simulates the unsigned request at a recorded Celo block and never broadcasts it.

## Flow

1. Read \`GET /api/capabilities\` and \`GET /api/openapi.json\`.
2. Send the unsigned proposal to \`POST /api/preflight/prepare\` with \`chainId\`, \`from\`, \`to\`, \`valueWei\`, \`data\`, and optional \`feeCurrency\`.
${claimStep}
4. Accept only a fresh report whose deterministic verdict matches your policy. Verify the ECDSA report signature independently when you need a portable audit trail.

## Safety boundary

- Preflight does not hold keys and cannot submit the proposal.
- A report can be claimed once: retries return the existing claimed report rather than creating another settlement.
- Public impact metrics count only receipts bound by the report issuer; they do not expose payer addresses.

## Browser and viem reference

The deployed web app uses \`@x402/fetch\`, \`@x402/evm\`, and a viem wallet client for the x402 retry. Copy the reviewed reference implementation from [payments.ts](https://github.com/Alike001/celo-preflight/blob/main/apps/web/src/payments.ts) and retain your own spending cap and user approval policy.
`
}

export function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Celo Preflight API',
      version: '1.0.0',
      description:
        'Agent and wallet intake for unsigned Celo transaction proposals. This API never broadcasts the proposed transaction.',
    },
    paths: {
      '/api/preflight/prepare': {
        post: {
          summary: 'Simulate and inspect an unsigned Celo transaction proposal.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['chainId', 'from', 'to', 'valueWei', 'data'],
                  properties: {
                    chainId: { enum: [42220, 11142220] },
                    from: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
                    to: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
                    valueWei: { type: 'string', pattern: '^\\d+$' },
                    data: { type: 'string', pattern: '^0x[a-fA-F0-9]*$' },
                    feeCurrency: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description:
                'Local-free mode returns a signed report. Hosted mode returns an unsigned evidence preview plus the metadata needed for an explicit x402 claim.',
            },
            '400': { description: 'Invalid unsigned transaction proposal.' },
            '503': { description: 'Celo state could not be inspected.' },
          },
        },
      },
      '/api/mento/live-usdm-kesm-proposal': {
        post: {
          summary: 'Build a current unsigned USDm-to-KESm Mento proposal from live chain data.',
          description:
            'Returns a proposal only. The caller must separately inspect it and decide whether to sign; this API never broadcasts.',
        },
      },
      '/api/reports/{id}/replay': {
        post: {
          summary: 'Re-run an existing report against its recorded Celo block.',
          description:
            'Read-only historical verification. Mento current tradability is not substituted for historical chain state.',
        },
      },
      '/api/impact': {
        get: {
          summary: 'Read aggregate, issuer-bound x402 claim evidence.',
          description:
            'Returns only public aggregate counts. It never exposes individual payer addresses or payment authorizations.',
        },
      },
    },
  }
}

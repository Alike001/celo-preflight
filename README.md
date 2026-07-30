# Celo Preflight

Celo Preflight is a deterministic safety inspector for unsigned Celo transactions. It simulates the call at a recorded Celo block, decodes supported intent, runs a published ruleset, and returns a signed `CLEAR`, `CAUTION`, or `BLOCK` report with the evidence behind every result.

It never broadcasts the transaction. AI never chooses the verdict.

**Try the live product:** [celo-preflight-production.up.railway.app](https://celo-preflight-production.up.railway.app). For a no-cost local run, follow the two commands below; hosted reports use x402 only after a user explicitly claims a prepared report.

## Run it in 30 seconds

Requirements: Node.js 22+ and pnpm 10.33.1.

```bash
pnpm install
pnpm dev
```

Open <http://127.0.0.1:5173>, choose **Load live sample**, review the unsigned input, then choose **Run local preflight**. The sample is only input; its verdict, block, gas estimate, report, and signature are computed live. Choose **Inspect your transaction** to open the manual form directly.

No wallet, private key, contract deployment, or environment configuration is required for local-free inspection. The default RPCs are Celo Forno mainnet and Celo Sepolia.

## What it checks

- execution success at an explicit snapshot block;
- whether calldata has a supported, inspectable shape;
- dangerous ERC-20 approvals, including unlimited allowance;
- current Mento Router routes, quotes, trading state, slippage, and deadlines;
- Celo fee-currency directory support;
- the exact organizer-assigned ERC-8021 attribution suffix needed for Track 1 credit.

Any failed safety proof produces `BLOCK`. Missing or ambiguous evidence produces `CAUTION`. Only fully supported applicable evidence produces `CLEAR`; an arbitrary contract with an ERC-20-shaped selector is never treated as a verified token.

## Commands

```bash
pnpm verify       # format, lint, types, tests, production builds, file-size policy
pnpm test:e2e     # desktop and mobile browser smoke tests
pnpm build        # emits apps/web/dist and apps/api/dist/index.js
pnpm --filter @preflight/api start
```

Ordinary tests use deterministic doubles and never submit a Celo transaction or spend funds.

## Hosted x402 mode

Hosted paid claims remain disabled unless the Celo facilitator URL, API key, seller address, and price in [`apps/api/.env.example`](apps/api/.env.example) are configured **and** the facilitator advertises x402 v2 `exact` settlement on `eip155:42220`. Create the API key at [x402.celo.org](https://x402.celo.org) by signing a message with the seller wallet; this is not a transaction and includes initial settlement credits. Add it to Railway only as `X402_FACILITATOR_API_KEY`—never to Git or the browser. A report is computed before payment, so invalid input or an unavailable RPC cannot charge the user. A successful claim stores only the real facilitator settlement receipt.

The public Celo facilitator was not DNS-reachable from this environment on July 17, 2026, so the shipped default is factual local-free mode rather than a simulated payment flow.

## Railway deployment

This repository deploys as one Railway service: its Express process serves both `apps/web/dist` and `/api/*` from one origin. Railway must mount one persistent volume at `/data` and set `DATA_DIR=/data`, `REPORT_SIGNER_PRIVATE_KEY` to a dedicated production key, and `REQUIRED_ATTRIBUTION_TAG` to the organizer-assigned tag. The checked-in health path is `/api/health`; Railway supplies `PORT` automatically.

## Report integrity

Every report includes its normalized request hash, chain and snapshot state, ruleset version, individual checks, issuer, expiry, and ECDSA signature. In local development an unfunded report-signing key is generated under `.data/`; production should inject a dedicated `REPORT_SIGNER_PRIVATE_KEY` and use a persistent `DATA_DIR`.

The report inspector includes a browser-only **Verify signature** tool that recomputes a report hash and recovers the signing address without calling the Preflight server. Wallets and agents can submit the same unsigned proposal shape through the [live OpenAPI contract](https://celo-preflight-production.up.railway.app/api/openapi.json); the API only simulates and reports—it never broadcasts the proposal.

For a live Mento proof, `POST /api/mento/live-usdm-kesm-proposal` with an `owner` address and positive `amountInWei`. It queries a fresh USDm → KESm route, current tradability, a quote, minimum output, deadline, and returns a separate bounded approval draft when one is required. Inspect the approval first; after it confirms externally, build a fresh route and inspect the swap. It does not invent a route or submit either transaction.

Set `REQUIRED_ATTRIBUTION_TAG` to the exact organizer-assigned `celo_…` tag before attempting Track 1 activity. A different tag, or merely any attribution suffix, does not receive this project's credit.

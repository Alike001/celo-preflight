# Celo Preflight

Celo Preflight is a deterministic safety inspector for unsigned Celo transactions. It simulates the call at a recorded Celo block, decodes supported intent, runs a published ruleset, and returns a signed `CLEAR`, `CAUTION`, or `BLOCK` report with the evidence behind every result.

It never broadcasts the transaction. AI never chooses the verdict.

**Try the live product:** [celo-preflight-production.up.railway.app](https://celo-preflight-production.up.railway.app). For a no-cost local run, follow the two commands below; hosted reports use x402 only after a user explicitly claims a prepared report.

## Try it in 30 seconds

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
pnpm test:deployed # read-only Railway health, report retrieval, and snapshot-replay smoke check
pnpm build        # emits apps/web/dist and apps/api/dist/index.js
pnpm --filter @preflight/api start
```

Ordinary tests use deterministic doubles and never submit a Celo transaction or spend funds.
`pnpm test:deployed` is intentionally separate from CI: it reads the public Railway service and
replays an existing report at its recorded Celo block, but never prepares a new report, requests
x402 payment, or broadcasts a transaction.

### Optional Mento local-fork proof

When Anvil is available, this repository can execute the live unsigned USDm → KESm approval and
swap drafts **only on a local fork**. It refuses any non-local RPC URL and never sends a transaction
to Celo Mainnet:

```bash
anvil --fork-url https://forno.celo.org --chain-id 42220 --auto-impersonate --port 8547
pnpm test:mento-fork
```

The verifier finds a funded public USDm holder in the forked state, funds it only inside Anvil for
local gas, confirms the bounded approval, executes the swap, and checks the token balances. This
proves the Mento contract path—not Celo's node-level fee-currency transaction execution. No local
fork result is presented as a Mainnet transaction.

### Optional Celo Sepolia fee-currency proof

The fee-currency verifier defaults to read-only. It confirms the current Celo Sepolia chain ID,
FeeCurrencyDirectory allowlist, USDC adapter mapping, and adapter-priced gas without using a key:

```bash
pnpm test:fee-currency-sepolia
```

The verifier treats the live `FeeCurrencyDirectory` as the source of truth and checks the adapter's
`adaptedToken()` before constructing anything. This matters because Celo documentation currently has
conflicting Sepolia USDC pairs: the live directory at the time this verifier was added mapped
adapter `0xbf1441Ea57f43f35f713431001f35742c88071c7` to token
`0x01C5C0122039549AD1493B8220cABEdD739BC44E`, while another documentation page listed a different
pair. The adapter—not the 6-decimal token—is required in `feeCurrency`; it presents its balance in
normalized 18-decimal units for gas calculations.

Only after explicitly authorizing one testnet transaction should you export a dedicated Celo Sepolia
key, a different testnet recipient, a positive USDC transfer amount, and a maximum USDC fee in base
units, then run:

```bash
pnpm test:fee-currency-sepolia --broadcast
```

The script refuses any chain other than Celo Sepolia, requires both transfer and fee caps, estimates
the adapter-priced gas before signing, and proves the adapter balance decreased after the successful
receipt. Never provide a Mainnet key or place this key in Railway.

## Hosted x402 mode

Hosted paid claims remain disabled unless the Celo facilitator URL, API key, seller address, and price in [`apps/api/.env.example`](apps/api/.env.example) are configured **and** the facilitator advertises x402 v2 `exact` settlement on `eip155:42220`. Create the API key at [x402.celo.org](https://x402.celo.org) by signing a message with the seller wallet; this is not a transaction and includes initial settlement credits. Add it to Railway only as `X402_FACILITATOR_API_KEY`—never to Git or the browser. Hosted preparation returns a real but unsigned evidence preview before payment, so invalid input or an unavailable RPC cannot charge the user; only an explicit claim asks the wallet to pay and returns a signed report with the real facilitator settlement receipt. A price challenge never reserves a report; a supplied authorization receives a durable single-claim reservation, so concurrent callers cannot settle the same report twice. Invalid 4xx authorizations may retry, while ambiguous facilitator 5xx outcomes stay fail-closed for receipt recovery. Hosted preview creation is limited to 12 requests per forwarded client address per minute, and expired unclaimed reports are retained for 24 hours before deletion; paid reports are preserved as audit evidence.

## Agent integration and public proof

Agents can start with the deployed [integration quickstart](https://celo-preflight-production.up.railway.app/api/agent.md) and [OpenAPI contract](https://celo-preflight-production.up.railway.app/api/openapi.json). The flow is deliberately narrow: prepare an unsigned proposal, claim its fresh signed report once through x402 when hosted mode requires it, then use the verdict as a pre-sign policy gate. Preflight never submits the proposed transaction.

The public [impact endpoint](https://celo-preflight-production.up.railway.app/api/impact) publishes aggregate issuer-bound claim and distinct-payer counts only. It does not expose payer addresses, private payment authorizations, or claim a unique-human count; settled-report retries return the existing report, while a simultaneous in-progress claim is rejected before it can authorize another settlement.

## Railway deployment

This repository deploys as one Railway service: its Express process serves both `apps/web/dist` and `/api/*` from one origin. Railway must mount one persistent volume at `/data` and set `DATA_DIR=/data`, `REPORT_SIGNER_PRIVATE_KEY` to a dedicated production key, and `REQUIRED_ATTRIBUTION_TAG` to the organizer-assigned tag. The checked-in health path is `/api/health`; Railway supplies `PORT` automatically.

## Report integrity

Every report includes its normalized request hash, chain and snapshot state, ruleset version, individual checks, issuer, expiry, and ECDSA signature. When an x402 receipt is later attached, the issuer produces a separate signature over that exact receipt and the original report signature; the browser verifier checks both. Older receipts without this separate binding are explicitly shown as legacy/unbound. In local development an unfunded report-signing key is generated under `.data/`; production should inject a dedicated `REPORT_SIGNER_PRIVATE_KEY` and use a persistent `DATA_DIR`.

The report inspector includes a browser-only **Verify signature** tool that recomputes a report hash and recovers the signing address without calling the Preflight server. Wallets and agents can submit the same unsigned proposal shape through the [live OpenAPI contract](https://celo-preflight-production.up.railway.app/api/openapi.json); the API only simulates and reports—it never broadcasts the proposal.

Stored reports include **Re-run snapshot**, a read-only replay against the report’s exact recorded Celo block. It reuses the original unsigned transaction and ruleset; for historical Mento calls, current tradability is deliberately not substituted for past state, so that missing historical proof remains `CAUTION` rather than being silently invented.

For a live Mento availability check, `POST /api/mento/live-usdm-kesm-proposal` with an `owner` address and positive `amountInWei`. When Celo has a valid current USDm → KESm route, it returns the route, tradability, quote, minimum output, deadline, and a separate bounded approval draft when required. When no valid median or route exists, it returns `503` and creates no approval or swap draft. Inspect any returned approval first; after it confirms externally, build a fresh route and inspect the swap. It never submits either transaction.

Set `REQUIRED_ATTRIBUTION_TAG` to the exact organizer-assigned `celo_…` tag before attempting Track 1 activity. A different tag, or merely any attribution suffix, does not receive this project's credit.

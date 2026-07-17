# Celo Preflight

Celo Preflight is a deterministic safety inspector for unsigned Celo transactions. It simulates the call at a recorded Celo block, decodes supported intent, runs a published ruleset, and returns a signed `CLEAR`, `CAUTION`, or `BLOCK` report with the evidence behind every result.

It never broadcasts the transaction. AI never chooses the verdict.

## Run it in 30 seconds

Requirements: Node.js 22+ and pnpm 10.33.1.

```bash
pnpm install
pnpm dev
```

Open <http://127.0.0.1:5173>, choose **Run live sample**. The sample is only unsigned input; its verdict, block, gas estimate, report, and signature are computed live. Choose **Inspect your transaction** to open the manual form directly.

No wallet, private key, contract deployment, or environment configuration is required for local-free inspection. The default RPCs are Celo Forno mainnet and Celo Sepolia.

## What it checks

- execution success at an explicit snapshot block;
- whether calldata has a supported, inspectable shape;
- dangerous ERC-20 approvals, including unlimited allowance;
- current Mento Router routes, quotes, trading state, slippage, and deadlines;
- Celo fee-currency directory support;
- ERC-8021 attribution suffix presence.

Any failed safety proof produces `BLOCK`. Missing or ambiguous evidence produces `CAUTION`. Only fully supported applicable evidence produces `CLEAR`.

## Commands

```bash
pnpm verify       # format, lint, types, tests, production builds, file-size policy
pnpm test:e2e     # desktop and mobile browser smoke tests
pnpm build        # emits apps/web/dist and apps/api/dist/index.js
pnpm --filter @preflight/api start
```

Ordinary tests use deterministic doubles and never submit a Celo transaction or spend funds.

## Hosted x402 mode

Hosted paid claims remain disabled unless all three x402 variables in [`apps/api/.env.example`](apps/api/.env.example) are configured **and** the facilitator advertises x402 v2 `exact` settlement on `eip155:42220`. A report is computed before payment, so invalid input or an unavailable RPC cannot charge the user. A successful claim stores only the real facilitator settlement receipt.

The public Celo facilitator was not DNS-reachable from this environment on July 17, 2026, so the shipped default is factual local-free mode rather than a simulated payment flow.

## Report integrity

Every report includes its normalized request hash, chain and snapshot state, ruleset version, individual checks, issuer, expiry, and ECDSA signature. In local development an unfunded report-signing key is generated under `.data/`; production should inject a dedicated `REPORT_SIGNER_PRIVATE_KEY` and use a persistent `DATA_DIR`.

See [`design.doc.md`](design.doc.md) for the accepted product design and [`research/domain-knowledge.md`](research/domain-knowledge.md) for the Celo-specific research behind the product choice.

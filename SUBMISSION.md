# Celo Preflight — Submission Brief

**Live product:** https://celo-preflight-production.up.railway.app  
**Source:** https://github.com/Alike001/celo-preflight  
**Track:** Most x402 Payments  
**Submitted PayTo wallet:** `0x1c9d2c90A690Fc6BD326034792Bf87F5af32bb8E`

## The four-sentence pitch

Agents and wallets can construct a Celo transaction, but a user still has to sign opaque calldata without knowing whether it grants unlimited authority, uses a suspended Mento route, or loses required attribution. Celo Preflight is a deterministic pre-sign safety inspector for unsigned Celo transactions. It simulates the proposal at a recorded Celo block, applies published Celo-specific rules, then returns a signed `CLEAR`, `CAUTION`, or `BLOCK` report; the hosted path releases that report only after a Celo x402 payment settles. This matters because agentic stablecoin payments need a reusable, auditable safety gate before a user or agent gives a transaction economic authority.

## What can be verified now

1. **A real Celo x402 settlement:** exactly $0.01 native USDC, settled through the Celo facilitator to the submitted PayTo wallet. [Open the Celo explorer transaction](https://celo.blockscout.com/tx/0x6d2152f52e93adb106143a4911f2b636f5c3a85efbcb2dd981bc20d092e5d741).
2. **The paid report and receipt binding:** [open the public signed report](https://celo-preflight-production.up.railway.app/api/reports/0x365498b23e1440cd64deee68d6ebb9af25e9ea0c6329ec918ded8f920f7e8854). Its settlement receipt is bound to the original report by a separate issuer signature.
3. **A deterministic live inspection:** open the product, choose **Run live sample**, then inspect the snapshot block, simulation result, individual rules, raw report, and browser-side signature verification.
4. **A meaningful unsafe case:** choose **Inspect your transaction**, set `From` to `0x1111111111111111111111111111111111111111`, `To` to Celo USDm `0x765DE816845861e75A25fCA122bb6898B8B1282a`, `Value` to `0`, and calldata to `0x095ea7b30000000000000000000000003333333333333333333333333333333333333333ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff`. The simulated call can succeed, but the published policy deterministically returns `BLOCK`.
5. **A no-network demo backup:** open `demo/offline/index.html` locally. It is clearly labelled historical recorded evidence and cannot request a payment or broadcast a transaction.

## Celo-specific value

- Celo mainnet state simulation with recorded block provenance.
- Native USDC/USDT x402 settlement through Celo's facilitator (`eip155:42220`).
- Celo fee-currency directory checks, including the live adapter for 6-decimal assets.
- Mento route, tradability, quote, slippage, and deadline checks.
- ERC-8021 attribution-suffix verification, including the assigned hackathon tag `celo_8aa7596a04af`.

## Honest boundary

Preflight never broadcasts the transaction it inspects. The separate Celo Sepolia fee-currency page is a read-only readiness check: it proves the live directory, adapter, fee estimate, and test-USDC balance, but MetaMask cannot sign Celo's fee-currency transaction type. It is therefore not presented as a completed fee-currency execution.

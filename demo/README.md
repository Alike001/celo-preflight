# Offline demo pack

This folder is the presentation fallback for Celo Preflight. It contains a captured, public,
issuer-bound x402 report and a replay of the same unsigned transaction at its exact recorded Celo
block. It is evidence, not a substitute for a fresh inspection.

## Make a fresh capture (online, read-only)

```bash
pnpm demo:capture
```

The command only performs `GET /api/reports/:id` and `POST /api/reports/:id/replay` against the
public deployment, then records the browser opening that existing historical report. It cannot
prepare a report, request an x402 payment, ask a wallet to sign, or broadcast a Celo transaction.

## Present without internet

Open `demo/offline/index.html` directly in a browser. It reads only the adjacent local
`demo/evidence/evidence.js` file. The three PNG screenshots and the WebM browser recording are in
`demo/captures/` after capture. Keep this folder together when copying it to a presentation laptop.

Do not describe this fallback as a live inspection. It preserves a real settled report, its
issuer-bound receipt, and a recorded exact-block replay for when live Celo or Railway access is
unavailable.

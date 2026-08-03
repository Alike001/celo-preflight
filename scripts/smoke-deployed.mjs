const baseUrl = (
  process.env.PREFLIGHT_URL ?? 'https://celo-preflight-production.up.railway.app'
).replace(/\/$/, '')

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init)
  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${path} failed (${response.status}): ${JSON.stringify(body)}`,
    )
  }
  return body
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const health = await request('/api/health')
assert(health.status === 'ok', 'Health endpoint did not report ok.')

const capabilities = await request('/api/capabilities')
assert(capabilities.hostedPaid === true, 'Hosted paid capability is not enabled.')
assert(capabilities.payment?.network === 'eip155:42220', 'Unexpected x402 network.')
assert(
  capabilities.attribution?.requiredCode?.startsWith('celo_'),
  'Assigned attribution tag missing.',
)

const history = await request('/api/reports')
const paid = history.reports.filter((report) => report.paid)
assert(paid.length > 0, 'No paid report is available for read-only smoke verification.')

const persistedReports = await Promise.all(
  paid.map(async (summary) => ({ summary, ...(await request(`/api/reports/${summary.id}`)) })),
)
const issuerBound = persistedReports.find((entry) => entry.report.paymentSignature)
const legacy = persistedReports.find((entry) => !entry.report.paymentSignature)
const selected = issuerBound ?? legacy
assert(selected, 'No persisted paid receipt was available for smoke verification.')
assert(
  selected.report.id === selected.summary.id,
  'Retrieved report ID differs from history entry.',
)

const replay = await request(`/api/reports/${selected.summary.id}/replay`, { method: 'POST' })
assert(
  replay.reportId === selected.summary.id,
  'Replay report ID differs from the selected report.',
)
assert(replay.facts?.snapshot?.blockNumber, 'Replay returned no snapshot block.')

console.log(
  JSON.stringify({
    status: 'ok',
    baseUrl,
    reportId: selected.summary.id,
    snapshotBlock: replay.facts.snapshot.blockNumber,
    receiptBinding: issuerBound ? 'issuer-bound' : 'legacy-unbound',
    legacyReceiptAlsoPresent: Boolean(legacy),
    writes: 'none',
  }),
)

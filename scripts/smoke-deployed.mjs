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
const historicalPaid = history.reports.find(
  (report) => report.paid && Date.parse(report.expiresAt) <= Date.now(),
)
assert(historicalPaid, 'No expired paid report is available for read-only smoke verification.')

const persisted = await request(`/api/reports/${historicalPaid.id}`)
assert(persisted.report.id === historicalPaid.id, 'Retrieved report ID differs from history entry.')
assert(
  Date.parse(persisted.report.expiresAt) <= Date.now(),
  'Smoke report unexpectedly is not expired.',
)
assert(
  !persisted.report.paymentSignature,
  'Expected existing report to remain honestly legacy/unbound.',
)

const replay = await request(`/api/reports/${historicalPaid.id}/replay`, { method: 'POST' })
assert(replay.reportId === historicalPaid.id, 'Replay report ID differs from the selected report.')
assert(replay.facts?.snapshot?.blockNumber, 'Replay returned no snapshot block.')

console.log(
  JSON.stringify({
    status: 'ok',
    baseUrl,
    reportId: historicalPaid.id,
    snapshotBlock: replay.facts.snapshot.blockNumber,
    receiptBinding: 'legacy-unbound',
    writes: 'none',
  }),
)

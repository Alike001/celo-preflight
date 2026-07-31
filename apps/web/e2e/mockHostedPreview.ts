import type { Page } from '@playwright/test'
import type { PreparedReport } from '@preflight/shared'

export async function mockHostedPreviewApi(page: Page, report: PreparedReport) {
  let claimRequests = 0
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/api/capabilities') {
      await json({
        localFree: false,
        hostedPaid: true,
        attribution: { configured: true, requiredCode: 'celo_preflight' },
        payment: { network: 'eip155:42220', price: '$0.01', payTo: `0x${'8'.repeat(40)}` },
      })
      return
    }
    if (url.pathname === '/api/reports' && route.request().method() === 'GET') {
      await json({ reports: [] })
      return
    }
    if (url.pathname === '/api/preflight/prepare') {
      await json(
        {
          mode: 'hosted-paid',
          claimRequired: true,
          prepared: {
            id: report.id,
            requestHash: report.requestHash,
            rulesetVersion: report.rulesetVersion,
            verdict: report.verdict,
            createdAt: report.createdAt,
            expiresAt: report.expiresAt,
            issuer: report.issuer,
          },
          preview: { facts: report.facts, checks: report.checks },
        },
        201,
      )
      return
    }
    if (url.pathname === '/api/preflight/claim') {
      claimRequests += 1
      await json({ error: 'Claim should not run before an explicit button click.' }, 500)
      return
    }
    await json({ error: 'Not found.' }, 404)
  })
  return () => claimRequests
}

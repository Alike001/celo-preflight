import { expect, test, type Page } from '@playwright/test'
import type { PreparedReport } from '@preflight/shared'

const report: PreparedReport = {
  id: `0x${'a'.repeat(64)}`,
  requestHash: `0x${'b'.repeat(64)}`,
  rulesetVersion: 'celo-preflight/1.0.0',
  verdict: 'CLEAR',
  createdAt: '2026-07-17T08:00:00.000Z',
  expiresAt: '2026-07-17T08:10:00.000Z',
  issuer: `0x${'9'.repeat(40)}`,
  facts: {
    transaction: {
      chainId: 42220,
      from: `0x${'1'.repeat(40)}`,
      to: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
      valueWei: '0',
      data: '0xa9059cbb',
    },
    snapshot: {
      blockNumber: '72370000',
      blockHash: `0x${'c'.repeat(64)}`,
      observedAt: 1_784_274_016,
      stateNote: 'All available evidence uses the snapshot block.',
    },
    simulation: { status: 'success', gasEstimate: '34980', returnData: '0x' },
    decoded: {
      kind: 'erc20-transfer',
      token: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
      recipient: `0x${'2'.repeat(40)}`,
      amount: '0',
    },
    attributionCodes: ['celo_preflight'],
  },
  checks: [
    {
      id: 'SIMULATION',
      title: 'Transaction simulation',
      status: 'PASS',
      summary: 'Call completed at the snapshot block.',
      details: { blockNumber: '72370000', gasEstimate: '34980' },
    },
    {
      id: 'CALL_DECODE',
      title: 'Call decoding',
      status: 'PASS',
      summary: 'The transaction uses a supported call shape.',
      details: { callKind: 'erc20-transfer' },
    },
    {
      id: 'ERC_8021',
      title: 'ERC-8021 attribution',
      status: 'PASS',
      summary: 'Attribution suffix data is present.',
      details: { codes: ['celo_preflight'] },
    },
  ],
  signature: `0x${'d'.repeat(130)}`,
}

async function mockApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (url.pathname === '/api/capabilities') {
      await json({
        localFree: true,
        hostedPaid: false,
        payment: { network: 'eip155:42220', unavailableReason: 'Not configured for tests.' },
      })
      return
    }
    if (url.pathname === '/api/reports' && route.request().method() === 'GET') {
      await json({ reports: [] })
      return
    }
    if (url.pathname === '/api/preflight/prepare') {
      await json({ mode: 'local-free', claimRequired: false, prepared: report, report }, 201)
      return
    }
    await json({ error: 'Not found.' }, 404)
  })
}

test('runs the primary evidence-first inspection path', async ({ page }, testInfo) => {
  await mockApi(page)
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Know what a Celo transaction will do before you sign.' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'AWAITING LIVE EVIDENCE' })).toBeVisible()
  await page.getByRole('button', { name: 'Run live sample' }).click()

  await expect(page.getByRole('heading', { name: 'CLEAR TO SIGN' })).toBeVisible()
  await expect(page.getByText('Snapshot block 72370000')).toBeVisible()
  await page.getByRole('row', { name: /Call decoding/ }).click()
  await expect(page.getByRole('heading', { name: 'Call decoding' })).toBeVisible()
  await expect(page.getByText('No x402 settlement is claimed')).toBeVisible()

  if (testInfo.project.name === 'mobile-chromium') {
    const checks = await page.getByRole('table', { name: 'Deterministic checks' }).boundingBox()
    const footer = await page.getByText('Snapshot block 72370000').locator('..').boundingBox()
    expect(checks).not.toBeNull()
    expect(footer).not.toBeNull()
    expect(footer!.y).toBeGreaterThanOrEqual(checks!.y + checks!.height)
  }
})

test('opens the manual transaction form without an extra route', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Inspect your transaction' }).click()
  await expect(page.getByRole('heading', { name: 'Inspect before you sign' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'From' })).toBeFocused()
})

test('opens real product documentation from the application bar', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Docs' }).click()

  await expect(page.getByRole('dialog', { name: 'How Celo Preflight works' })).toBeVisible()
  await expect(page.getByText(/preflight does not submit your transaction/i)).toBeVisible()
  await page.getByRole('button', { name: 'Close documentation' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
})

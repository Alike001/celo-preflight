import { expect, test } from '@playwright/test'

test('opens public historical evidence through the real API without a write', async ({ page }) => {
  const apiRequests: Array<{ method: string; path: string }> = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) {
      apiRequests.push({ method: request.method(), path: url.pathname })
    }
  })

  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(
    page.getByRole('heading', { name: 'Know what a Celo transaction will do before you sign.' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'View historical report' })).toBeVisible()

  await page.getByRole('button', { name: 'View historical report' }).click()
  await expect(page.getByRole('heading', { name: /HISTORICAL .* EXPIRED/ })).toBeVisible()
  await expect(page.getByText(/no x402 settlement is claimed|settlement receipt/i)).toBeVisible()

  expect(apiRequests.some((request) => request.path === '/api/capabilities')).toBe(true)
  expect(apiRequests.some((request) => request.path === '/api/reports')).toBe(true)
  expect(apiRequests.some((request) => /^\/api\/reports\/0x[0-9a-f]+$/i.test(request.path))).toBe(
    true,
  )
  expect(apiRequests.every((request) => request.method === 'GET')).toBe(true)
})

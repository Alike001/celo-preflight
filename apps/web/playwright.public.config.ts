import { defineConfig, devices } from '@playwright/test'

const baseURL = (
  process.env.PREFLIGHT_URL ?? 'https://celo-preflight-production.up.railway.app'
).replace(/\/$/, '')

export default defineConfig({
  testDir: './e2e',
  testMatch: 'public-smoke.spec.ts',
  forbidOnly: true,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'public-chromium', use: { ...devices['Desktop Chrome'] } }],
})

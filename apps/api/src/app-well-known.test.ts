import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { expect, it, vi } from 'vitest'
import type { Address } from '@preflight/shared'
import type { ApiConfig } from './config.js'
import { createApp } from './app.js'
import type { PaymentCapability } from './payment-layer.js'
import { MemoryReports } from './test-support.js'

const address = (digit: string) => `0x${digit.repeat(40)}` as Address

const config: ApiConfig = {
  port: 0,
  dataDir: '.data-test-unused',
  rpcUrls: { 42220: 'http://unused', 11142220: 'http://unused' },
  requiredAttributionCode: 'celo_preflight_test',
}

const payment: PaymentCapability = {
  enabled: false,
  network: 'eip155:42220',
  reason: 'Not configured for tests.',
}

it('serves an ERC-8004 registration document from the public well-known path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'celo-preflight-web-'))
  const previous = process.env.WEB_DIST_DIR
  try {
    await mkdir(join(directory, '.well-known'))
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Test shell</title>')
    await writeFile(
      join(directory, '.well-known', 'agent.json'),
      JSON.stringify({ name: 'Celo Preflight', services: [{ name: 'web' }] }),
    )
    process.env.WEB_DIST_DIR = directory
    const runtime = await createApp(config, {
      reports: new MemoryReports(),
      inspector: { inspect: vi.fn() },
      signer: { issuer: address('9'), sign: vi.fn() },
      payment,
    })

    const response = await request(runtime.app).get('/.well-known/agent.json')
    expect(response.status).toBe(200)
    expect(response.type).toMatch(/application\/json/)
    expect(response.body).toMatchObject({ name: 'Celo Preflight' })
  } finally {
    if (previous === undefined) delete process.env.WEB_DIST_DIR
    else process.env.WEB_DIST_DIR = previous
    await rm(directory, { recursive: true, force: true })
  }
})

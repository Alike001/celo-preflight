import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createPrepareRateLimit } from './request-guard.js'

describe('hosted prepare rate limit', () => {
  it('bounds bursts per forwarded client address without blocking another client', async () => {
    const app = express()
    app.set('trust proxy', 1)
    app.post(
      '/prepare',
      createPrepareRateLimit({ maxRequests: 2, windowMs: 60_000 }),
      (_req, res) => {
        res.status(201).json({ ok: true })
      },
    )

    for (let count = 0; count < 2; count += 1) {
      expect(
        (await request(app).post('/prepare').set('X-Forwarded-For', '203.0.113.9')).status,
      ).toBe(201)
    }
    const blocked = await request(app).post('/prepare').set('X-Forwarded-For', '203.0.113.9')
    expect(blocked.status).toBe(429)
    expect(blocked.headers['retry-after']).toBeDefined()
    expect(
      (await request(app).post('/prepare').set('X-Forwarded-For', '203.0.113.10')).status,
    ).toBe(201)
  })
})

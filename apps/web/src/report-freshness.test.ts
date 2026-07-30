import { describe, expect, it } from 'vitest'
import { isReportExpired } from './report-freshness.js'

describe('isReportExpired', () => {
  it('treats an expiry at or before now as stale', () => {
    expect(
      isReportExpired({ expiresAt: '2026-07-30T10:00:00.000Z' }, Date.UTC(2026, 6, 30, 10)),
    ).toBe(true)
  })

  it('keeps a future expiry current', () => {
    expect(
      isReportExpired({ expiresAt: '2026-07-30T10:00:01.000Z' }, Date.UTC(2026, 6, 30, 10)),
    ).toBe(false)
  })

  it('fails closed for an invalid expiry', () => {
    expect(isReportExpired({ expiresAt: 'not-a-date' })).toBe(true)
  })
})

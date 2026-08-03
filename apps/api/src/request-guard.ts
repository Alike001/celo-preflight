import type { RequestHandler } from 'express'

interface RequestWindow {
  count: number
  resetAt: number
}

export interface PrepareRateLimitOptions {
  maxRequests?: number
  windowMs?: number
}

/**
 * Bounds anonymous hosted preview creation. It is intentionally in-memory:
 * reports remain durable, while this guard only protects the single deployed
 * Railway process from accidental or abusive bursts.
 */
export function createPrepareRateLimit(options: PrepareRateLimitOptions = {}): RequestHandler {
  const maxRequests = options.maxRequests ?? 12
  const windowMs = options.windowMs ?? 60_000
  const windows = new Map<string, RequestWindow>()

  return (request, response, next) => {
    const now = Date.now()
    const key = request.ip ?? 'unknown'
    const current = windows.get(key)
    const active =
      current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs }

    if (active.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((active.resetAt - now) / 1_000))
      response.setHeader('Retry-After', retryAfter.toString())
      response.status(429).json({ error: 'Too many inspection requests. Try again shortly.' })
      return
    }

    active.count += 1
    windows.set(key, active)
    if (windows.size > 1_000) {
      for (const [candidate, value] of windows) {
        if (value.resetAt <= now) windows.delete(candidate)
      }
    }
    next()
  }
}

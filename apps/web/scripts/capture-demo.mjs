import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from '@playwright/test'

const source = (
  process.env.PREFLIGHT_URL ?? 'https://celo-preflight-production.up.railway.app'
).replace(/\/$/, '')
const reportId =
  process.env.PREFLIGHT_DEMO_REPORT_ID ??
  '0x365498b23e1440cd64deee68d6ebb9af25e9ea0c6329ec918ded8f920f7e8854'
const here = dirname(fileURLToPath(import.meta.url))
const demoRoot = join(here, '../../../demo')
const evidenceDir = join(demoRoot, 'evidence')
const capturesDir = join(demoRoot, 'captures')
const videoDir = join(capturesDir, 'video')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, init) {
  const response = await fetch(`${source}${path}`, init)
  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${path} failed (${response.status}): ${JSON.stringify(body)}`,
    )
  }
  return body
}

await mkdir(evidenceDir, { recursive: true })
await mkdir(videoDir, { recursive: true })

// Both requests are read-only: one retrieves a settled report and the other replays it at its
// recorded Celo block. This script cannot prepare a new report, request x402 payment, or broadcast.
const reportResponse = await request(`/api/reports/${reportId}`)
const replay = await request(`/api/reports/${reportId}/replay`, { method: 'POST' })
const report = reportResponse.report
assert(
  report?.payment?.transactionHash,
  'The selected report does not have a Celo settlement receipt.',
)
assert(report?.paymentSignature, 'The selected receipt is not issuer-bound.')
assert(replay?.facts?.snapshot?.blockNumber, 'Replay response has no recorded Celo block.')

const capturedAt = new Date().toISOString()
const manifest = {
  capturedAt,
  source,
  reportId,
  operations: ['GET /api/reports/:id', 'POST /api/reports/:id/replay'],
  writes: 'local demo artifacts only',
  chainWrites: 'none',
  paymentRequests: 'none',
  reportVerdict: report.verdict,
  snapshotBlock: replay.facts.snapshot.blockNumber,
  settlementTransaction: report.payment.transactionHash,
}

await writeFile(
  join(evidenceDir, 'recorded-report.json'),
  `${JSON.stringify(reportResponse, null, 2)}\n`,
)
await writeFile(join(evidenceDir, 'recorded-replay.json'), `${JSON.stringify(replay, null, 2)}\n`)
await writeFile(join(evidenceDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(
  join(evidenceDir, 'evidence.js'),
  `window.PREFLIGHT_RECORDED_EVIDENCE = ${JSON.stringify({ manifest, report, replay })}\n`,
)

await rm(videoDir, { recursive: true, force: true })
await mkdir(videoDir, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const live = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  })
  const livePage = await live.newPage()
  await livePage.goto(source, { waitUntil: 'networkidle' })
  await livePage.screenshot({ path: join(capturesDir, '01-live-landing.png'), fullPage: true })
  await livePage.getByRole('button', { name: 'View historical report' }).click()
  await livePage.getByRole('heading', { name: /CLEAR|CAUTION|BLOCK/ }).waitFor()
  await livePage.screenshot({
    path: join(capturesDir, '02-live-signed-report.png'),
    fullPage: true,
  })
  await live.close()

  const offline = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await offline.goto(pathToFileURL(join(demoRoot, 'offline/index.html')).href)
  await offline.getByText('Recorded evidence — no internet required').waitFor()
  await offline.screenshot({
    path: join(capturesDir, '03-offline-evidence-fallback.png'),
    fullPage: true,
  })
} finally {
  await browser.close()
}

const videos = (await readdir(videoDir)).filter((file) => file.endsWith('.webm'))
assert(videos.length === 1, `Expected one browser recording, found ${videos.length}.`)
await rename(join(videoDir, videos[0]), join(capturesDir, 'celo-preflight-recorded-evidence.webm'))

console.log(JSON.stringify({ status: 'ok', ...manifest, output: demoRoot }, null, 2))

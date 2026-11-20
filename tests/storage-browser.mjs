// Fixed clock and controlled providers in an isolated browser profile.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
const server = await createServer({
  configFile: false,
  logLevel: 'error',
  define: { __RENDER_BUILD__: JSON.stringify('fixed-test-renderer') },
  plugins: [
    {
      name: 'storage-test',
      configureServer(s) {
        s.middlewares.use('/test-storage', (_, r) =>
          r.end('<!doctype html><title>Storage test</title>'),
        )
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0, hmr: false },
})
let browser
try {
  await server.listen()
  const path = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || (existsSync(path) ? path : undefined),
  })
  const ctx = await browser.newContext(),
    a = await ctx.newPage(),
    b = await ctx.newPage()
  const url = 'http://127.0.0.1:' + server.httpServer.address().port + '/test-storage'
  await Promise.all([a.goto(url), b.goto(url)])
  for (const page of [a, b])
    await page.evaluate(async () => {
      await import('/@vite/client')
      window.store = await import('/src/store.ts')
      window.geo = (await import('/data/dasan74.json')).default.geo
      window.calls = 0
      window.refresh = () =>
        window.store.resolvePlace(window.geo.place, true, async () => {
          window.calls++
          await new Promise((r) => setTimeout(r, 500))
          return window.geo
        })
    })
  const [one, two] = await Promise.all([
    a.evaluate(() => window.refresh()),
    b.evaluate(() => window.refresh()),
  ])
  const calls = (await a.evaluate(() => window.calls)) + (await b.evaluate(() => window.calls))
  assert.equal(calls, 1)
  assert.equal(one.snap.hash, two.snap.hash)
  assert.equal(one.snap.lastSuccessfulFetchAt, two.snap.lastSuccessfulFetchAt)
  const result = await a.evaluate(async () => {
    const { geo, store } = window,
      { layout } = await import('/src/geography.ts')
    const snap = (await store.snapshots())[0]
    const p = {
      id: 'studio-project',
      name: '테스트',
      origin: 'osm',
      geo,
      spec: layout(geo, '테스트'),
      review: { status: 'pending', verifiedAt: null, note: '' },
    }
    const key = await store.fileKey(p),
      saved = await store.archive(key, p.id, 'test.zip', new Blob(['archive-data']))
    const recovered = await store.readArchive(key)
    const changed = structuredClone(p)
    changed.spec.ink = '#112233'
    const text = structuredClone(p)
    text.spec.items.find((i) => i.kind === 'text').text = '다른 문구'
    const otherUser = structuredClone(p)
    otherUser.id = 'separate-project'
    const keys = await Promise.all([p, changed, text, otherUser].map(store.fileKey))
    const reused = await store.resolvePlace(geo.place, false, async () => {
      throw Error('unexpected fetch')
    })
    return {
      distinct: new Set(keys).size,
      hash: saved.hash,
      readHash: recovered.hash,
      unchanged: snap.lastSuccessfulFetchAt === reused.snap.lastSuccessfulFetchAt,
      reuse: reused.state,
    }
  })
  assert.equal(result.distinct, 4)
  assert.equal(result.hash, result.readHash)
  assert.ok(result.unchanged)
  assert.equal(result.reuse, 'reused')
  const report = {
    timestamp: new Date().toISOString(),
    browser: browser.version(),
    concurrentTabs: 2,
    providerCalls: calls,
    snapshotHash: one.snap.hash,
    successAt: one.snap.lastSuccessfulFetchAt,
    expiresAt: one.snap.expiresAt,
    ...result,
  }
  mkdirSync('artifacts', { recursive: true })
  writeFileSync('artifacts/storage-check.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  await browser?.close()
  await server.close()
}

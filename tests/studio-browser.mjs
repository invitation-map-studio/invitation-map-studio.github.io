// Exercise the installed app through its public UI in an isolated Chrome profile.
// Pass the deployment origin and a local credential-delivery file for the live smoke test.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import { unzipSync } from 'fflate'
const origin = process.argv[2] || 'http://127.0.0.1:4173/'
if (
  !['127.0.0.1', 'localhost', 'invitation-map-studio.github.io'].includes(new URL(origin).hostname)
)
  throw Error('Unsupported test origin')
const code = readFileSync(process.argv[3], 'utf8').trim().split('\n').at(-1)
const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (existsSync(mac) ? mac : undefined),
})
const report = {
  time: new Date().toISOString(),
  origin,
  browser: browser.version(),
  checks: [],
  externalCalls: [],
}
const check = (s) => report.checks.push(s)
const dir = 'artifacts'
mkdirSync(dir, { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 960 } }),
    providers = []
  page.on('request', (r) => {
    if (new URL(r.url()).hostname === 'overpass-api.de') providers.push(r.method())
  })
  await page.goto(origin, { waitUntil: 'networkidle' })
  assert.equal(await page.locator('#studio').isVisible(), false)
  assert.deepEqual(providers, [])
  check('새 탭 잠금 · 공급자 호출 0건')
  await page.locator('#password').fill(code)
  await page.locator('#enter').click()
  await page.locator('#studio').waitFor({ state: 'visible' })
  assert.match(await page.locator('#project-title').innerText(), /자연앤푸르지오/)
  await page.screenshot({ path: dir + '/studio-desktop.jpg', type: 'jpeg' })
  await page.locator('#review-panel summary').click()
  const review = page.locator('#review')
  const feedback = page.locator('#review-status')
  await review.click()
  assert.match(await feedback.innerText(), /관찰 내용.*네이버 지도 링크.*4개/)
  await page.locator('#review-note').fill('격리된 브라우저에서 저장 기능 확인')
  for (const value of ['잘못된 URL', 'https://invitation-map-studio.github.io/']) {
    await page.locator('#review-source').fill(value)
    await review.click()
    assert.match(await feedback.innerText(), /공유 링크/)
  }
  await page.locator('#review-source').fill('https://naver.me/example')
  const boxes = page.locator('#review-checks input')
  for (const b of (await boxes.all()).slice(0, 3)) await b.check()
  await review.click()
  assert.match(await feedback.innerText(), /1개가 체크되지/)
  await boxes.last().check()
  await review.click()
  await feedback.filter({hasText:'대조 기록을 저장했습니다.'}).waitFor()
  await page.locator('#open').click()
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('저장된 프로젝트를 열었습니다'))
  assert.match(await feedback.innerText(), /대조 기록을 저장했습니다/)
  assert.equal(await page.locator('#paper [data-item="title"]').textContent(), '오시는 길')
  assert.equal(await page.locator('#review-note').inputValue(), '격리된 브라우저에서 저장 기능 확인')
  await page.locator('#review-panel summary').click()
  check('대조 기록 누락·잘못된 링크·체크 수 안내와 저장 후 다시 열기')
  await page.locator('#search-submit').click()
  await page.waitForFunction(() =>
    document.querySelector('#search-status').textContent.includes('도로명주소를 입력'),
  )
  await page.locator('#address').fill('세종대로')
  await page.locator('#search-submit').click()
  await page.waitForFunction(() =>
    document.querySelector('#search-status').classList.contains('error'),
  )
  const messageBox = await page.locator('#search-status').boundingBox()
  assert.ok(messageBox && messageBox.y + messageBox.height <= 960)
  check('주소 오류를 검색 버튼 바로 아래에 표시')
  await page.locator('#address').fill('다산중앙로82번안길 74')
  await page.locator('#search button').click()
  await page.waitForFunction(
    () =>
      document.querySelector('#search-status').textContent.includes('저장본 재사용') ||
      document.querySelector('#search-status').textContent.includes('갱신'),
  )
  check('주소 입력으로 다산74 생성 또는 재사용')
  await page.locator('#element').selectOption('venue')
  await page.locator('#caption').fill('검사용 안내')
  await page.locator('#apply').click()
  await page.waitForFunction(() =>
    document.querySelector('#paper').textContent.includes('검사용 안내'),
  )
  await page.locator('#undo').click()
  await page.waitForFunction(
    () => !document.querySelector('#paper').textContent.includes('검사용 안내'),
  )
  check('문구 편집·실행 취소')
  await page.locator('#maponly').check()
  assert.equal(await page.locator('#paper [data-item="address"]').count(), 0)
  await page.locator('#maponly').uncheck()
  check('지도만 표시 시 footer 제거')
  const backup = page.waitForEvent('download')
  await page.locator('#backup').click()
  const backupPath = await (await backup).path(),
    saved = JSON.parse(readFileSync(backupPath, 'utf8'))
  assert.equal(saved.geo.place.id, 'way/825237097')
  await page.locator('#import').setInputFiles({
    name: 'project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  })
  await page.waitForFunction(() =>
    document.querySelector('#meta').textContent.includes('최신성 미확인'),
  )
  check('JSON 다운로드·다시 열기·검수 초기화')
  await page.locator('#download').click()
  const zipLink = page.getByRole('link', { name: '전체 ZIP 다운로드' })
  await zipLink.waitFor({ timeout: 120000 })
  const first = page.waitForEvent('download')
  await zipLink.click()
  const bytes = readFileSync(await (await first).path()),
    files = unzipSync(bytes)
  assert.equal(Object.keys(files).length, 10)
  check('공개 UI에서 ZIP 다운로드·10개 파일 재열기')
  await page.waitForFunction(() =>
    document.querySelector('#status').textContent.includes('보관했습니다'),
  )
  const second = page.waitForEvent('download')
  await page.locator('#download').click()
  const bytes2 = readFileSync(await (await second).path())
  assert.deepEqual(bytes, bytes2)
  check('보관 파일 재사용·SHA-256 일치')
  report.zipHash = createHash('sha256').update(bytes).digest('hex')
  if (process.env.TEST_LIVE_PROVIDER === '1') {
    await page.locator('#dasan74').evaluate((b) => (b.closest('details').open = true))
    await page.locator('#dasan74').click()
    await page.locator('#refresh').click()
    await page
      .waitForFunction(() => !document.querySelector('#cancel').hidden, { timeout: 3000 })
      .catch(() => {})
    await page.locator('#cancel').waitFor({ state: 'hidden', timeout: 95000 })
    report.liveRefresh = await page.locator('#status').innerText()
    report.externalCalls = providers
  }
  await page.reload()
  assert.equal(await page.locator('#studio').isVisible(), false)
  check('새로고침 후 다시 잠금')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: dir + '/studio-mobile-layout.jpg', type: 'jpeg' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  check('390px 화면 가로 넘침 없음 (Chrome)')
} finally {
  writeFileSync(dir + '/studio-browser.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
console.log(JSON.stringify(report))

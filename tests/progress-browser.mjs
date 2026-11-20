// Hold the road index and SDK separately so foreground and background states are observable.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const [origin, passwordFile] = process.argv.slice(2)
const local = new URL(origin).origin === 'http://127.0.0.1:4792'
assert.ok(local || new URL(origin).origin === 'https://invitation-map-studio.github.io')
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let releaseSdk
  const sdkGate = new Promise(resolve => { releaseSdk = resolve })
  await page.route('https://oapi.map.naver.com/**', async route => {
    await sdkGate
    if (!local) return route.continue()
    return route.fulfill({contentType:'text/javascript', body:`
      window.naver={maps:{LatLng:class{}, Map:class{destroy(){}}, Marker:class{setMap(){}},
        Service:{Status:{OK:1},geocode:({query},cb)=>cb(1,{v2:{status:'OK',addresses:[
          {roadAddress:query,x:'127.16459',y:'37.61471'}]}})}}};window.onWeddingMapSdkReady()`})
  })
  let releaseRoads
  const roadGate = new Promise(resolve => { releaseRoads = resolve })
  await page.route('**/major-roads/index.json', async route => {
    await roadGate
    await route.continue().catch(() => {})
  })
  await page.goto(origin)
  const panel = page.locator('#work-progress')
  const bar = page.getByRole('progressbar')
  await page.locator('#password').fill(readFileSync(passwordFile,'utf8').trim().split('\n').at(-1))
  await page.locator('#enter').click()
  await page.locator('#studio').waitFor()
  await panel.waitFor({state:'hidden'})
  await page.locator('#address').fill('남양주 다산 중앙로 82번 안길 74')
  await page.locator('#search-submit').click()
  await page.getByRole('progressbar',{name:'주변 도로와 지하철 출구 조회 중'}).waitFor()
  assert.equal(await bar.getAttribute('aria-valuenow'),null)
  await page.locator('#search-cancel').click()
  await panel.waitFor({state:'hidden'})
  await page.locator('#search-status').filter({hasText:'취소'}).waitFor()
  releaseRoads()
  await page.locator('#search-submit').click()
  await page.getByRole('progressbar',{name:'네이버 위치 대조 중'}).waitFor()
  assert.equal(await page.locator('#search-submit').getAttribute('aria-busy'),null)
  // The export takes precedence over the independent Naver check.
  await page.evaluate(() => {
    const bar = document.querySelector('#progress-bar')
    window.counts = []
    new MutationObserver(() => {
      if (bar.hasAttribute('aria-valuenow')) window.counts.push(Number(bar.getAttribute('aria-valuenow')))
    }).observe(bar,{attributes:true,attributeFilter:['aria-valuenow']})
  })
  await page.locator('#download').click()
  await page.getByRole('progressbar',{name:'인쇄 파일 생성 중'}).waitFor()
  assert.equal(await bar.getAttribute('aria-valuemax'),'10')
  await page.getByRole('link',{name:'전체 ZIP 다운로드'}).waitFor({timeout:120000})
  await page.getByRole('progressbar',{name:'네이버 위치 대조 중'}).waitFor()
  const counts = await page.evaluate(() => window.counts)
  assert.ok(counts.length >= 2 && counts.every((n,i) => n >= 1 && n <= 10 && (!i || n >= counts[i-1])))
  releaseSdk()
  await page.locator('#naver-map p').filter({hasText:'도로명주소 일치'}).waitFor({timeout:30000})
  await panel.waitFor({state:'hidden'})
  await page.locator('#address').fill('도로명 누락')
  await page.locator('#search-submit').click()
  await page.locator('#search-status').filter({hasText:'도로명과 건물번호'}).waitFor()
  assert.equal(await panel.isVisible(),false)
  assert.deepEqual(errors,[])
  console.log('조회·취소·네이버 대조·인쇄 파일 개수·오류 정리 확인', counts.join(','))
} finally {
  await browser.close()
}

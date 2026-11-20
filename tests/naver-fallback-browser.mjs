// Run on local Vite or deployed Pages. Delay only the independent print data on Pages.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const [origin, passwordFile] = process.argv.slice(2)
const local = origin === 'http://127.0.0.1:4792/'
assert.ok(local || origin === 'https://invitation-map-studio.github.io/')
const address = '서울특별시 강남구 학동로 519'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let release, startRequest
  const pending = new Promise(resolve => { release = resolve })
  const requested = new Promise(resolve => { startRequest = resolve })
  await page.route('**/address-index/*.bin', r => r.fulfill({status:404}))
  await page.route('https://overpass-api.de/**', async r => {
    startRequest()
    await pending
    await r.fulfill({status:429}).catch(() => {})
  })
  if (local) await page.route('https://oapi.map.naver.com/**', r => r.fulfill({
    contentType:'text/javascript', body:`
      window.geocodes = 0
      window.naver = {maps:{LatLng:class {},Map:class {destroy(){}},Marker:class {setMap(){}},
        Service:{Status:{OK:1},geocode:({query},cb)=>{
          window.geocodes++
          cb(1,{v2:{status:'OK',addresses:[{roadAddress:query,x:'127.05546',y:'37.52019'}]}})
        }}}}; window.onWeddingMapSdkReady()`,
  }))
  await page.goto(origin)
  await page.locator('#password').fill(readFileSync(passwordFile,'utf8').trim().split('\n').at(-1))
  await page.locator('#enter').click()
  await page.locator('#address').fill(address + ' (19층)')
  await page.locator('#placename').fill('빌라드지디 청담')
  await page.locator('#search-submit').click()
  await page.locator('#fallback-info').waitFor({timeout:15000})
  await requested
  await page.locator('#naver-map p').filter({hasText:/네이버 주소 위치.*청담역 12번 출구/}).waitFor({timeout:45000})
  assert.equal(await page.locator('#paper').isVisible(),false)
  assert.equal(await page.locator('#search-submit').getAttribute('aria-busy'),'true')
  assert.equal(await page.locator('#fallback-link').getAttribute('href'),'https://map.naver.com/p/search/'+encodeURIComponent(address))
  await page.evaluate(() => { window.print = () => { window.printCalled = true } })
  await page.locator('#print-card').click()
  assert.ok(await page.evaluate(() => window.printCalled))
  await page.emulateMedia({media:'print'})
  assert.ok(await page.locator('#card-qr').isVisible())
  assert.ok(await page.locator('#card-qr').evaluate(img => img.naturalWidth > 0))
  assert.equal(await page.locator('#card-address').textContent(),address)
  assert.equal(await page.locator('#naver-map').isVisible(),false)
  await page.emulateMedia({media:'screen'})
  release()
  await page.locator('#search-status').filter({hasText:'Overpass 응답 429'}).waitFor()
  assert.ok(await page.locator('#fallback-info').isVisible())
  assert.equal(await page.locator('#download').isVisible(),false)
  await page.locator('#address').fill('세종대로 124')
  assert.equal(await page.locator('#fallback-info').isVisible(),false)
  assert.ok(await page.locator('#paper').isVisible())
  if (local) {
    // Let the same civic address finish after the live map is already visible.
    await page.unroute('**/address-index/*.bin')
    let releaseIndex
    const pendingIndex = new Promise(resolve => { releaseIndex = resolve })
    await page.route('**/address-index/*.bin', async r => {
      await pendingIndex
      await r.continue()
    })
    await page.locator('#address').fill(address)
    await page.locator('#search-submit').click()
    await page.locator('#naver-map p').filter({hasText:'네이버 주소 위치'}).waitFor()
    const calls = await page.evaluate(() => window.geocodes)
    releaseIndex()
    await page.locator('#project-title').filter({hasText:'빌라드지디 청담'}).waitFor()
    await page.locator('#naver-map p').filter({hasText:'도로명주소 일치'}).waitFor()
    assert.equal(await page.locator('#fallback-info').isVisible(),false)
    assert.equal(await page.evaluate(() => window.geocodes),calls)
  }
  assert.deepEqual(errors,[])
  console.log('Overpass 지연·429에서 네이버 주소 위치, 청담역 12번 출구, 주소 QR 인쇄 및 주소 변경 확인')
} finally {
  await browser.close()
}

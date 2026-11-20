// Exercise both independent print routes in fresh profiles with Overpass unavailable.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { unzipSync, strFromU8 } from 'fflate'

const [origin, passwordFile] = process.argv.slice(2)
const local = origin === 'http://127.0.0.1:4792/'
assert.ok(local || origin === 'https://invitation-map-studio.github.io/')
const address = '서울특별시 강남구 학동로 519'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  for (const footprints of [false, true]) {
    const page = await browser.newPage()
    const errors = []
    let overpass = 0
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/address-index/*.bin', r => r.fulfill({ status:404 }))
    if (footprints) await page.route('**/commercial-addresses/*.bin', r => r.fulfill({ status:404 }))
    await page.route('https://overpass-api.de/**', r => { overpass++; return r.abort() })
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
    await page.locator('#project-title').filter({hasText:'빌라드지디 청담'}).waitFor({timeout:45000})
    await page.locator('#meta').filter({hasText: footprints ? '건물 내부 대표점' : '소상공인시장진흥공단'}).waitFor()
    await page.locator('#naver-map p').filter({hasText:/도로명주소 일치.*50m 이내/}).waitFor({timeout:30000})
    const paper = page.locator('#paper')
    assert.ok(await paper.locator('[data-item^="junction-"]').count() > 0)
    assert.ok(await paper.locator('[data-item^="road-"]').count() > 0)
    assert.ok(await paper.locator('[data-item="destination"]').isVisible())
    assert.match(await paper.textContent(), /학동로/)
    assert.match(await paper.textContent(), /청담역 12번 출구/)
    assert.equal(await page.locator('#print-card').count(), 0)
    await page.locator('#download').click()
    const link = page.getByRole('link', {name:'전체 ZIP 다운로드'})
    await link.waitFor({timeout:120000})
    const received = page.waitForEvent('download')
    await link.click()
    const files = unzipSync(readFileSync(await (await received).path()))
    const svg = strFromU8(files[Object.keys(files).find(k => k.endsWith('Editable.svg'))])
    for (const label of ['빌라드지디 청담','학동로','청담역 12번 출구','19층']) assert.ok(svg.includes(label),label)
    const pdf = files[Object.keys(files).find(k => k.endsWith('.pdf'))]
    assert.equal(strFromU8(pdf.slice(0,5)), '%PDF-')
    assert.equal(overpass,0)
    if (local) assert.equal(await page.evaluate(() => window.geocodes),1)
    assert.deepEqual(errors,[])
    console.log(footprints ? '네이버 위치·OSM 건물 도형 대조' : '공공 상가 주소',
      '· Overpass 호출 0 · 교차로/학동로/청담역 12번 출구/목적지 표시 · SVG/PDF 확인')
    await page.close()
  }
} finally {
  await browser.close()
}

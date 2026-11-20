// Pass the public origin (or local Vite), then the local password delivery file.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { strFromU8, unzipSync } from 'fflate'

const [origin, passwordFile] = process.argv.slice(2)
const local = origin === 'http://127.0.0.1:4792/'
assert.ok(local || origin === 'https://invitation-map-studio.github.io/')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const cases = [
  ['서울특별시 중구 세종대로 124 (태평로1가, 한국프레스센터 19~20층)', '한국프레스센터', '세종대로', '시청역', 'press'],
  ['서울특별시 강남구 테헤란로 610', '글래드호텔', '테헤란로', '삼성역', 'glad'],
]
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let releaseRoads
  if (local) {
    const delayed = new Promise(resolve => { releaseRoads = resolve })
    await page.route('https://overpass-api.de/**', async r => {
      await delayed
      await r.fulfill({ status: 429 }).catch(() => {})
    })
    await page.route('https://oapi.map.naver.com/**', r => r.fulfill({contentType:'text/javascript',body:`
      window.requests = 0
      window.naver = {maps:{LatLng:class {},Map:class {destroy(){}},Marker:class {setMap(){}},
        Service:{Status:{OK:1},geocode:({query},cb)=>{
          window.requests++
          const [x,y]=query.includes('세종대로')?['126.97785','37.56741']:['127.06457','37.50886']
          cb(1,{v2:{status:'OK',addresses:[{roadAddress:query,x,y}]}})
        }}}}; window.onWeddingMapSdkReady()`}))
  }
  await page.goto(origin)
  await page.locator('#password').fill(readFileSync(passwordFile,'utf8').trim().split('\n').at(-1))
  await page.locator('#enter').click()
  for (const [address, name, street, station, slug] of cases) {
    await page.locator('#address').fill(address)
    await page.locator('#search-submit').click()
    await page.locator('#project-title').filter({hasText:name}).waitFor({timeout:120000})
    await page.locator('#naver-map').getByText(/도로명주소 일치.*50m 이내/).waitFor({timeout:45000})
    await page.waitForFunction(() => !document.querySelector('#search-submit').hasAttribute('aria-busy'), null, {timeout:150000})
    const paper = page.locator('#paper')
    assert.equal(await paper.locator('[data-item="title"]').textContent(),'오시는 길')
    assert.ok(await paper.locator('[data-item^="junction-"]').count() > 0)
    assert.equal(await paper.locator('[data-item^="dot-"],[data-item^="label-"]').count(),0)
    assert.match(await paper.textContent(),new RegExp(station))
    await page.locator('#download').click()
    const link = page.getByRole('link', {name:'전체 ZIP 다운로드'})
    await link.waitFor({timeout:120000})
    const waitDownload = page.waitForEvent('download')
    await link.click()
    if (local) releaseRoads()
    const files = unzipSync(readFileSync(await (await waitDownload).path()))
    const find = ext => Object.keys(files).find(k => k.endsWith(ext))
    const svg = strFromU8(files[find('Editable.svg')])
    for (const label of [name,street,station]) assert.ok(svg.includes(label), label)
    assert.ok(!svg.includes('네이버 위치 대조') && !svg.includes('확인 필요 시안'))
    const pdf = files[find('.pdf')]
    assert.equal(strFromU8(pdf.slice(0,5)),'%PDF-')
    mkdirSync('artifacts/minimal', {recursive:true})
    writeFileSync('artifacts/minimal/'+slug+'.pdf',pdf)
    console.log(name, await page.locator('#naver-map p').textContent(), Object.keys(files).length+'개 출력 파일')
  }
  if (local) assert.equal(await page.evaluate(() => window.requests),2)
  assert.deepEqual(errors,[])
} finally {
  await browser.close()
}

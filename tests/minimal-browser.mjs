// Pass the public origin (or local Vite), then the local password delivery file.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { strFromU8, unzipSync } from 'fflate'

const [origin, passwordFile, onlyCase] = process.argv.slice(2)
const local = origin === 'http://127.0.0.1:4792/'
assert.ok(local || origin === 'https://invitation-map-studio.github.io/')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const cases = [
  ['서울특별시 중구 세종대로 124 (태평로1가, 한국프레스센터 19~20층)', '한국프레스센터', '세종대로', '시청역', 'press'],
  ['서울특별시 강남구 학동로 519', '빌라드지디 청담', '학동로', '청담역 12번 출구', 'cheongdam'],
  ['서울특별시 강남구 테헤란로 610', '글래드호텔', '테헤란로', '삼성역', 'glad'],
  ['서울특별시 강남구 봉은사로 637', '노블발렌티', '봉은사로', '봉은사역 4번 출구', 'noble'],
].filter(row => !onlyCase || row[4] === onlyCase)
assert.ok(cases.length)
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
          const [x,y]=query.includes('세종대로')?['126.97785','37.56741']:
            query.includes('봉은사로')?['127.06484','37.51533']:
            query.includes('학동로')?['127.05546','37.52019']:['127.06457','37.50886']
          cb(1,{v2:{status:'OK',addresses:[{roadAddress:query,x,y}]}})
        }}}}; window.onWeddingMapSdkReady()`}))
  }
  await page.goto(origin)
  await page.locator('#password').fill(readFileSync(passwordFile,'utf8').trim().split('\n').at(-1))
  await page.locator('#enter').click()
  if (local) {
    await page.getByText('기준 약도 보기', {exact:true}).click()
    await page.locator('#dasan20').click()
    const legacyPin = page.locator('#paper [data-item="ref-44"]')
    await legacyPin.locator('path').waitFor()
    assert.equal(await legacyPin.locator('ellipse').count(), 0)
  }
  for (const [address, name, street, station, slug] of cases) {
    await page.locator('#search-format').selectOption(slug === 'noble' ? 'grid' : 'classic')
    await page.locator('#address').fill(address)
    await page.locator('#search-submit').click()
    await page.locator('#project-title').filter({hasText:name}).waitFor({timeout:120000})
    await page.locator('#naver-map').getByText(/도로명주소 일치.*50m 이내/).waitFor({timeout:45000})
    await page.waitForFunction(() => !document.querySelector('#search-submit').hasAttribute('aria-busy'), null, {timeout:150000})
    const paper = page.locator('#paper')
    assert.equal(await paper.locator('[data-item="title"]').textContent(),'오시는 길')
    assert.ok(await paper.locator('[data-item^="junction-"]').count() <= 6)
    assert.ok(await paper.locator('circle[data-item="transit-stop-A"][fill="#fff"]').count())
    assert.ok(await paper.locator('[data-item="destination"] path').count())
    assert.equal(await paper.locator('[data-item^="dot-"],[data-item^="label-"]').count(),0)
    assert.ok(Number(await paper.locator('[data-item="venue"]').getAttribute('y')) > 440)
    const buildings = await paper.locator('[data-item^="building-name-"]').allTextContents()
    assert.ok(buildings.length >= 1 && buildings.length <= 6, JSON.stringify(buildings))
    assert.equal(await paper.locator('[data-item="scale-caption"],[data-item="scale-bar"]').count(),0)
    const shopCount = await paper.locator('rect[data-item^="building-mark-"]').count()
    const busCount = await paper.locator('g[data-item^="building-bus-mark-"] rect').count()
    assert.ok(buildings.length >= shopCount && buildings.length <= shopCount + Number(busCount > 0))
    assert.equal(new Set(buildings).size, buildings.length)
    assert.match(await paper.textContent(),new RegExp(station))
    if (slug === 'cheongdam') {
      assert.equal(await paper.locator('[data-item="transit-stop-B"]').count(),1)
      const paired = await paper.evaluate(svg => {
        const item = id => svg.querySelector('[data-item="' + id + '"]')
        const venue = item('venue').getBBox(), pin = item('destination').transform.baseVal.getItem(0).matrix
        const station = item('transit-exit-A').getBBox(), circle = item('transit-stop-A')
        return { role:item('venue-role')?.textContent, venueRight:venue.x+venue.width, pinX:pin.e,
          venueBottom:venue.y+venue.height, stationTop:station.y, stationX:station.x+station.width/2,
          circleX:Number(circle.getAttribute('cx')), circleY:Number(circle.getAttribute('cy')) }
      })
      assert.equal(paired.role, '도착지')
      assert.ok(Math.abs(paired.venueRight - paired.pinX) < 55)
      assert.ok(paired.venueBottom < paired.circleY && paired.stationTop > paired.circleY)
      assert.ok(Math.abs(paired.stationX - paired.circleX) < 2)
      const arterials = await paper.locator('[data-item^="street-"]').allTextContents()
      for (const name of ['학동로','영동대로','도산대로','삼성로','올림픽대로']) assert.ok(arterials.includes(name), arterials.join(', '))
      assert.equal(await paper.locator('[data-item^="road-"][data-item$="-center"]').count(),0)
      assert.ok(busCount > 0)
      assert.ok(buildings.some(label => !label.endsWith('정류장')))
      assert.ok(await paper.locator('[data-item^="building-bus-mark-"] circle').count() >= 2)
      assert.ok(await paper.locator('[data-item="destination"] ellipse').count() === 0)
      const caption = await paper.locator('[data-item="transit-exit-A"],[data-item="transit-number-A"]').allTextContents()
      assert.equal(caption.join(' '), station)
      assert.match(await paper.locator('[data-item="transit-guide-A"]').textContent(), /청담역 12번 출구.*7호선.*직선 약 40m/)
    }
    if (slug === 'noble') {
      const format = page.locator('#map-format')
      const idle = () => page.locator('#work-progress').waitFor({state:'hidden'})
      const horizontalOrVertical = () => paper.locator('path[data-item^="road-"]').evaluateAll(paths =>
        paths.length > 0 && paths.every(path => {
          const p = path.getAttribute('d').match(/-?[\d.]+/g).map(Number)
          for (let i = 2; i < p.length; i += 2)
            if (Math.abs(p[i]-p[i-2]) > .01 && Math.abs(p[i+1]-p[i-1]) > .01) return false
          return true
        }))
      assert.equal(await format.inputValue(), 'grid')
      assert.equal(await horizontalOrVertical(), true)
      const labels = await paper.locator('[data-item^="street-"]').allTextContents()
      for (const label of ['봉은사로','영동대로']) assert.ok(labels.includes(label), label)
      const gridId = await page.locator('#saved').inputValue()
      await format.selectOption('classic')
      await idle()
      assert.equal(await horizontalOrVertical(), false)
      assert.notEqual(await page.locator('#saved').inputValue(), gridId)
      await page.locator('#building-limit').selectOption('0')
      await idle()
      await format.selectOption('grid')
      await idle()
      assert.equal(await page.locator('#saved').inputValue(), gridId)
      assert.equal(await page.locator('#building-limit').inputValue(), 'auto')
      assert.equal(await horizontalOrVertical(), true)
      await format.selectOption('classic')
      await idle()
      assert.equal(await page.locator('#building-limit').inputValue(), '0')
      await format.selectOption('grid')
      await idle()
    }
    await page.locator('#download').click()
    const link = page.getByRole('link', {name:'전체 ZIP 다운로드'})
    await link.waitFor({timeout:120000})
    const waitDownload = page.waitForEvent('download')
    await link.click()
    if (local) releaseRoads()
    const files = unzipSync(readFileSync(await (await waitDownload).path()))
    const find = ext => Object.keys(files).find(k => k.endsWith(ext))
    const svg = strFromU8(files[find('Editable.svg')])
    for (const label of [name,street,station,...buildings]) assert.ok(svg.includes(label), label)
    assert.ok(!svg.includes('네이버 위치 대조') && !svg.includes('확인 필요 시안'))
    const pdf = files[find('.pdf')]
    assert.equal(strFromU8(pdf.slice(0,5)),'%PDF-')
    mkdirSync('artifacts/minimal', {recursive:true})
    writeFileSync('artifacts/minimal/'+slug+'.pdf',pdf)
    writeFileSync('artifacts/minimal/'+slug+'.png',files[find('_Map.png')])
    if (slug === 'cheongdam') {
      const idle = () => page.locator('#work-progress').waitFor({state:'hidden'})
      async function quickFile(format) {
        await idle()
        const next = page.waitForEvent('download')
        await page.locator('#save-' + format).click()
        const file = await next
        await idle()
        return readFileSync(await file.path())
      }
      assert.deepEqual(await quickFile('png'), Buffer.from(files[find('_Map.png')]))
      await page.locator('#maponly').check()
      assert.deepEqual(await quickFile('svg'), Buffer.from(files[find('_MapOnly.svg')]))
      await page.locator('#maponly').uncheck()
      const saved = await page.locator('#saved').inputValue()
      const stationX = await paper.locator('[data-item="transit-stop-A"]').getAttribute('cx')
      await page.locator('#map-radius').selectOption('300')
      await page.locator('#status').filter({hasText:'300 m 범위로 새 배치'}).waitFor()
      await idle()
      assert.notEqual(await page.locator('#saved').inputValue(), saved)
      assert.notEqual(await paper.locator('[data-item="transit-stop-A"]').getAttribute('cx'), stationX)
      assert.equal(await paper.locator('[data-item="transit-stop-B"]').count(),0)
      await page.locator('#building-limit').selectOption('2')
      await idle()
      assert.equal(await paper.locator('[data-item^="building-mark-"]').count(),2)
      const bus = await paper.locator('[data-item^="building-bus-mark-"]').count()
      await page.locator('#building-limit').selectOption('0')
      await idle()
      assert.equal(await paper.locator('[data-item^="building-mark-"]').count(),0)
      assert.equal(await paper.locator('[data-item^="building-bus-mark-"]').count(), bus)
      assert.equal(await paper.locator('[data-item="destination"]').count(),1)
      await page.locator('#undo').click()
      await idle()
      assert.equal(await paper.locator('[data-item^="building-mark-"]').count(),2)
      const lanes = paper.locator('[data-item^="local-lane-"],[data-item^="local-addr-lane-"],[data-item^="local-street-name"]')
      const feet = paper.locator('[data-item^="local-foot-"],[data-item^="local-addr-foot-"]')
      const footCount = await feet.count()
      assert.ok(footCount > 0)
      const toggle = page.getByRole('switch', {name:'골목길 표시'})
      assert.equal(await toggle.isChecked(),false)
      assert.equal(await lanes.count(),0)
      const withoutLanes = await quickFile('png')
      writeFileSync('artifacts/minimal/청담-300m-골목길-숨김.png', withoutLanes)
      const svgWithoutLanes = await quickFile('svg')
      await toggle.check()
      await idle()
      assert.ok(await lanes.count() > 0)
      const laneName = paper.locator('[data-item="local-street-name-학동로96길"]')
      assert.equal(await laneName.textContent(),'학동로96길')
      assert.equal(await feet.count(),footCount)
      assert.notDeepEqual(await quickFile('svg'),svgWithoutLanes)
      await page.locator('#open').click()
      await idle()
      assert.equal(await toggle.isChecked(),true)
      assert.ok(await lanes.count() > 0)
      await toggle.uncheck()
      await idle()
      assert.equal(await lanes.count(),0)
      assert.equal(await feet.count(),footCount)
      assert.deepEqual(await quickFile('png'),withoutLanes)
      await page.locator('#saved').selectOption(saved)
      await page.locator('#open').click()
      await idle()
      assert.equal(await page.locator('#map-radius').inputValue(),'auto')
      assert.equal(await page.locator('#building-limit').inputValue(),'auto')
      assert.equal(await paper.locator('[data-item="transit-stop-A"]').getAttribute('cx'), stationX)
    }
    console.log(name, buildings.join(', '), await page.locator('#naver-map p').textContent(), Object.keys(files).length+'개 출력 파일')
  }
  if (local) assert.equal(await page.evaluate(() => window.requests),cases.length)
  assert.deepEqual(errors,[])
} finally {
  await browser.close()
}

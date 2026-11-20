// Run with node tests/export-browser.mjs [output-directory]. Requires local Chrome or Playwright Chromium.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { unzipSync } from 'fflate'

const outputDir = process.argv[2] && resolve(process.argv[2])
const v2Archive = process.env.WEDDING_V2_ARCHIVE
const v2ImagePath = 'Wedding_Map_Automation_v2/samples/full/Dasan20_v2_Reference_Map_Transparent.png'
const v2Png = v2Archive && unzipSync(readFileSync(v2Archive), {filter:entry=>entry.name===v2ImagePath})[v2ImagePath]
if(v2Archive) assert.ok(v2Png,'v2 samples/full baseline')
const harness = {
  name: 'export-test-page',
  configureServer(server) {
    if(v2Png) server.middlewares.use('/__v2_raster.png', (_, response) => {
      response.setHeader('Content-Type','image/png')
      response.end(Buffer.from(v2Png))
    })
    server.middlewares.use('/__export_test', (_, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end('<!doctype html><html lang="ko"><title>약도 출력 검사</title><body></body></html>')
    })
  }
}
const server = await createServer({
  configFile: false, plugins: [harness], logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, middlewareMode: false, hmr: false },
})
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const executablePath = process.env.CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined)
  browser = await chromium.launch({executablePath})
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${address.port}/__export_test`)
  const generated = await page.evaluate(async compareV2 => {
    const { exportMap, exportPreview } = await import('/src/export.ts')
    const { serialize } = await import('/src/render.ts')
    const { default: spec } = await import('/src/reference.json')
    const project = {name:'파로스컨벤션', origin:'reference', spec, review:{status:'pending',verifiedAt:null,note:''}}
    const fullSvg = serialize(project)
    const mapOnlySvg = serialize(project, true)
    const input = {fullSvg, mapOnlySvg, basename:'Dasan20_Wedding',
      readme:'파로스컨벤션 · 다산순환로 20. 제공된 기준 약도를 재출력했습니다. 전체 약도 140 × 144 mm, 지도만 140 × 114 mm. PNG 600 dpi. 편집용 SVG 글꼴은 Noto Serif/Sans CJK KR입니다. 원본 비율을 유지하여 배치해 주세요.',
      verification:'출처: 사용자 제공 Dasan20_Wedding_Map_Editable.svg 및 Readme_KO.txt. 원본 문서 위치 확인일 2026-11-14. 이 출력에서는 독립 위치 대조를 수행하지 않았습니다. 입구 위치 확인 필요.'}
    const started = performance.now()
    const result = await exportMap(input)
    const preview = await exportPreview(fullSvg)
    const png = {}
    for (const [filename, blob] of [...result.files, ['preview.png', preview]]) {
      if (!filename.endsWith('.png')) continue
      const img = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      png[filename] = {size:[img.width, img.height], corner:[...ctx.getImageData(0, 0, 1, 1).data]}
      img.close()
      canvas.width = canvas.height = 1
    }
    async function mask(blob) {
      const img = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = 700
      canvas.height = 720
      const ctx = canvas.getContext('2d', {willReadFrequently:true})
      ctx.drawImage(img, 0, 0, 700, 720)
      img.close()
      const data = ctx.getImageData(0, 0, 700, 720).data
      canvas.width = canvas.height = 1
      return Uint8Array.from({length:data.length / 4}, (_, i) => data[4 * i + 3] > 63 ? 1 : 0)
    }
    const current = await mask(result.files.get('Dasan20_Wedding_Map_Transparent.png'))
    async function baselineOverlap(url) {
      const original = await mask(await (await fetch(url)).blob())
      let union = 0, intersection = 0
      for (let i = 0; i < current.length; i++) {
        union += original[i] | current[i]
        intersection += original[i] & current[i]
      }
      return intersection / union
    }
    const maskIntersectionOverUnion = await baselineOverlap('/reference/Dasan20_Wedding_Map_Files/Dasan20_Wedding_Map_Transparent.png')
    const v2MaskIntersectionOverUnion = compareV2 ? await baselineOverlap('/__v2_raster.png') : undefined
    const repro = await exportMap(input)
    const same = Object.entries(result.hashes).every(([name, sha]) => repro.hashes[name] === sha)
    const ctrl = new AbortController()
    let aborted = false
    try {
      await exportMap(input, {signal:ctrl.signal, onProgress() {ctrl.abort()}})
    } catch (error) {
      aborted = error.name === 'AbortError'
    }
    const b64 = await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.readAsDataURL(result.zip)
    })
    return {png, hashes:result.hashes, b64, same, aborted,
      maskIntersectionOverUnion, v2MaskIntersectionOverUnion, durationMs: Math.round(performance.now() - started)}
  }, Boolean(v2Png))
  const {b64, ...report} = generated
  const zip = Buffer.from(b64, 'base64')
  const files = unzipSync(zip)
  assert.equal(Object.keys(files).length, 10)
  assert.equal(report.same, true, 'deterministic rendering')
  assert.equal(report.aborted, true, 'abort during export')
  assert.ok(report.maskIntersectionOverUnion >= 0.85, 'reference map pixel overlap at 700 × 720')
  if(v2Png) assert.ok(report.v2MaskIntersectionOverUnion >= .90, 'v2 samples/full overlap')
  for (const [filename, bytes] of Object.entries(files)) {
    assert.equal(createHash('sha256').update(bytes).digest('hex'), report.hashes[filename])
    const data = Buffer.from(bytes)
    if (filename.endsWith('.png')) {
      let density = []
      for (let i = 8; i < data.length; i += data.readUInt32BE(i) + 12) {
        if (data.toString('ascii', i + 4, i + 8) === 'pHYs') {
          density.push([data.readUInt32BE(i+8), data.readUInt32BE(i+12), data[i+16]])
        }
      }
      assert.deepEqual(density, [[23622, 23622, 1]])
      const {size, corner} = report.png[filename]
      assert.deepEqual(size, [3307, filename.includes('MapOnly') ? 2693 : 3402])
      if (filename.includes('Transparent')) assert.equal(corner[3], 0)
      else assert.deepEqual(corner, filename.includes('White') ? [255,255,255,255] : [251,249,245,255])
    }
    if (filename.endsWith('.svg')) {
      const svg = data.toString()
      assert.equal(svg.includes('<text '), filename.includes('Editable'))
      if (filename.includes('MapOnly')) {
        assert.ok(svg.includes('viewBox="0 0 1400 1140"'))
        assert.ok(!svg.includes('031-565-8000') && !svg.includes('GATE 2'))
      }
    }
    if (filename.endsWith('.pdf')) {
      const pdf = data.toString('latin1')
      const media = /\/MediaBox\s*\[\s*0\.?\s+0\.?\s+([\d.]+)\s+([\d.]+)/.exec(pdf)
      assert.ok(media, 'PDF MediaBox')
      const mm = media.slice(1,3).map(v => Number(v) * 25.4 / 72)
      assert.ok(Math.abs(mm[0] - 140) < .001 && Math.abs(mm[1] - 144) < .001)
      assert.equal((pdf.match(/\/Type\s+\/Page\b/g) || []).length, 1)
      assert.ok(!/\/Subtype\s*\/Image\b/.test(pdf), 'no embedded bitmap')
      const start = pdf.indexOf('stream\n') + 7
      const end = pdf.indexOf('\nendstream', start)
      const commands = inflateSync(data.subarray(start, end)).toString('ascii')
      assert.ok((commands.match(/\bc\b/g) || []).length > 100, 'glyph curves in page stream')
      report.pdf = {pages:1, sizeMm:mm, embeddedImages:0, curves:(commands.match(/\bc\b/g) || []).length}
    }
  }
  assert.deepEqual(report.png['preview.png'].size, [827,850])
  Object.assign(report, {browser:browser.version(), timestamp:new Date().toISOString(), zipSha256:createHash('sha256').update(zip).digest('hex')})
  const dasan = await page.evaluate(async () => {
    const {default:data} = await import('/data/dasan74.json')
    const {layout} = await import('/src/geography.ts')
    const {serialize} = await import('/src/render.ts')
    const {exportMap} = await import('/src/export.ts')
    const {importProject} = await import('/src/validate.ts')
    const project = {schema:1, id:'dasan74-baseline', name:data.name, address:data.address,
      origin:'osm', spec:layout(data.geo, data.name), geo:data.geo, lastSuccessfulFetchAt:data.fetchedAt,
      expiresAt:new Date(Date.parse(data.fetchedAt)+86_400_000).toISOString(), lastAccessedAt:data.fetchedAt,
      imported:false, review:{status:'pending',verifiedAt:null,note:'단지 대표점. 보행·차량 입구 확인 필요.'}}
    const roundTrip = importProject(JSON.stringify(project))
    if (JSON.stringify(roundTrip.spec)!==JSON.stringify(project.spec) || roundTrip.review.status !== 'pending') {
      throw Error('다산74 프로젝트 왕복 오류')
    }
    const readme = [data.name, data.address,'꽃은 단지의 대표점입니다. 보행·차량 출입구는 확인이 필요합니다.',
      '전체 약도 140 × 144 mm, 지도 전용 140 × 114 mm. PNG 600 dpi. 인쇄용 PDF는 벡터 1쪽입니다.',
      '편집용 SVG 글꼴은 Noto Serif/Sans CJK KR입니다.',
      data.source.attribution, data.source.copyrightUrl, data.source.license, data.source.licenseUrl].join('\n')
    const verification = [data.evidence.addressSiteMatch, data.evidence.addressSource,
      '주소·단지명 대조일 '+data.evidence.addressCheckedOn, data.evidence.geometrySource,
      'OSM 취득 시각 '+data.fetchedAt, '객체 '+data.location.osmId+' v'+data.location.version,
      '대표점은 단지 외곽선에서 산출한 도심입니다. 보행·차량 입구 및 현장 확인 필요.',
      data.source.attribution, data.source.copyrightUrl, data.source.licenseUrl].join('\n')
    const {files, zip, hashes} = await exportMap({fullSvg:serialize(project), mapOnlySvg:serialize(project,true),
      basename:'Dasan74_Wedding', readme, verification})
    for (const name of ['Dasan74_Wedding_Map.svg','Dasan74_Wedding_MapOnly.svg','Dasan74_Wedding_Map_Editable.svg']) {
      if (!(await files.get(name).text()).includes('OpenStreetMap contributors')) throw Error('출처 누락')
    }
    const b64 = await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.readAsDataURL(zip)
    })
    return {project, b64, hashes}
  })
  const dasanZip = Buffer.from(dasan.b64, 'base64')
  const addressFiles = unzipSync(dasanZip)
  assert.equal(Object.keys(addressFiles).length, 10)
  for (const [name, bytes] of Object.entries(addressFiles)) {
    assert.equal(createHash('sha256').update(bytes).digest('hex'), dasan.hashes[name])
  }
  report.dasan74 = {roads:dasan.project.geo.roads.length, landmarks:dasan.project.geo.landmarks.length,
    mapItems:dasan.project.spec.items.length, review:dasan.project.review, files:Object.keys(addressFiles).length,
    hashes:dasan.hashes, zipSha256:createHash('sha256').update(dasanZip).digest('hex')}
  if (outputDir) {
    mkdirSync(outputDir, {recursive:true})
    writeFileSync(resolve(outputDir, 'Dasan20_Files.zip'), zip)
    writeFileSync(resolve(outputDir, 'Dasan74_Files.zip'), dasanZip)
    writeFileSync(resolve(outputDir, 'Dasan74_Project.json'), JSON.stringify(dasan.project,null,2)+'\n')
    writeFileSync(resolve(outputDir, 'export-check.json'), JSON.stringify(report,null,2)+'\n')
  }
  console.log(JSON.stringify(report,null,2))
} finally {
  await browser?.close()
  await server.close()
}

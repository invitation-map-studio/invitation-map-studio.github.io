// Run after assess.py to measure the actual browser renderer on the offline site models.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const directory = process.argv[2]
const index = JSON.parse(readFileSync(join(directory, 'results.json'), 'utf8'))
const server = await createServer({configFile: false, logLevel:'error',
  server: {host:'127.0.0.1',port:0,hmr:false},
  plugins:[{name:'offline-evaluation', configureServer(s) {
    s.middlewares.use('/evaluation', (_req,res) => {
      res.setHeader('Content-Type','text/html; charset=utf-8')
      res.end('<!doctype html><html lang="ko"><title>약도 평가</title><body></body></html>')
    })
  }}]})
let browser
try {
  await server.listen()
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({executablePath:process.env.CHROME_PATH || (existsSync(mac) ? mac : undefined)})
  const page = await browser.newPage()
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.goto(origin + '/evaluation')
  index.browser = browser.version()
  for (const [i, row] of index.records.entries()) {
    const stem = String(i + 1).padStart(2,'0')
    const geo = JSON.parse(readFileSync(join(directory,stem+'.json'),'utf8'))
    const result = await page.evaluate(async ({geo,name,stem}) => {
      const {exportMap,exportPreview} = await import('/src/export.ts')
      const {layout} = await import('/src/geography.ts')
      const {serialize} = await import('/src/render.ts')
      const project = {origin:'osm',name,review:{status:'pending'},spec:layout(geo,name)}
      const full = serialize(project)
      const start = performance.now()
      const bundle = await exportMap({fullSvg:full,mapOnlySvg:serialize(project,true),basename:'Case'+stem,
        readme:'평가용 파일 · OpenStreetMap contributors · ODbL 1.0',verification:'원천 단지·시설 객체 확인. 현장 및 입구 확인 필요.'})
      const milliseconds = Math.round(performance.now()-start)
      const base64 = blob => new Promise(resolve => {
        const reader = new FileReader()
        reader.addEventListener('load',() => resolve(reader.result.split(',')[1]))
        reader.readAsDataURL(blob)
      })
      const preview = (stem === '03' || stem === '10') ? await base64(await exportPreview(full)) : null
      return {zip:await base64(bundle.zip),milliseconds,preview,hashes:bundle.hashes}
    },{geo,name:row.name,stem})
    const archive = Buffer.from(result.zip,'base64')
    const files = unzipSync(archive)
    assert.equal(Object.keys(files).length,10)
    for (const [name,source] of Object.entries(files)) {
      const data = Buffer.from(source)
      assert.equal(result.hashes[name],createHash('sha256').update(data).digest('hex'))
      if (name.endsWith('.png')) {
        assert.equal(data.readUint32BE(16),3307)
        assert.equal(data.readUint32BE(20),name.includes('MapOnly')?2693:3402)
        const density = []
        for(let j=8;j<data.length;j+=12+data.readUint32BE(j)){
          if(data.toString('ascii',j+4,j+8)==='pHYs') density.push([data.readUint32BE(j+8),data.readUint32BE(j+12),data[j+16]])
        }
        assert.deepEqual(density,[[23622,23622,1]])
      }
      if(name.endsWith('.svg')) assert.ok(data.toString().includes('OpenStreetMap contributors'))
      if(name.endsWith('.pdf')) {
        const text = data.toString('latin1')
        assert.doesNotMatch(text,/\/Subtype\s*\/Image\b/)
        assert.match(text,/\/Type\s*\/Page\b/)
      }
    }
    row.export = {milliseconds:result.milliseconds, zipEntries:10, zipBytes:archive.byteLength,
      zipSha256:createHash('sha256').update(archive).digest('hex')}
    if(result.preview) writeFileSync(join(directory,stem+'.png'),Buffer.from(result.preview,'base64'))
  }
  writeFileSync(join(directory,'results.json'),JSON.stringify(index,null,2)+'\n')
} finally {
  await browser?.close()
  await server.close()
}

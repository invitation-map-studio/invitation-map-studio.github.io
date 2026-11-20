import assert from 'node:assert/strict'
import test from 'node:test'
import data from '../data/dasan74.json'
import {DAY,fresh,iso,pending,placeKey,type Geography} from '../src/model'
import {resolveSnapshot} from '../src/store'
import {importProject} from '../src/validate'
import {fetchGeography} from '../src/geography'
const geo=data.geo as Geography, initial=Date.parse('2026-11-19T14:00:00Z')
const snap={geo,hash:'known',lastSuccessfulFetchAt:iso(initial),lastAccessedAt:iso(initial),expiresAt:iso(initial+DAY),imported:false as const}

test('C01, C02 · midnight and exact 24h boundary',async()=>{
  let calls=0
  const provider=async()=>{calls++;return geo}
  const reuse=await resolveSnapshot(snap,false,provider,()=>initial+DAY-1)
  assert.equal(reuse.state,'reused');assert.equal(calls,0)
  assert.equal(reuse.snap.lastSuccessfulFetchAt,snap.lastSuccessfulFetchAt);assert.equal(reuse.snap.expiresAt,snap.expiresAt)
  const result=await resolveSnapshot(reuse.snap,false,provider,()=>initial+DAY)
  assert.equal(calls,1);assert.equal(result.state,'refreshed');assert.equal(result.snap.expiresAt,iso(initial+2*DAY))
})
test('C03 · source object, coordinates, entrance, address and coverage affect identity',()=>{
  for(const change of [{id:'way/10'},{radius:400},{lat:37},{entrance:'vehicle'},{address:'다산순환로 20'}]) assert.notEqual(placeKey(geo.place),placeKey({...geo.place,...change}))
  assert.equal(placeKey(geo.place),placeKey({...geo.place,address:'  '+geo.place.address+' '}))
})
test('C05, C07 · partial response/limit retain prior snapshot; manual refresh, skew and import',async()=>{
  let calls=0
  const result=await resolveSnapshot(snap,true,async()=>{calls++;throw Error('429')},()=>initial+10)
  assert.equal(calls,1);assert.equal(result.state,'failed');assert.deepEqual(result.snap,snap)
  assert.equal(fresh({...snap,imported:true},initial),false)
  assert.equal(fresh({...snap,lastAccessedAt:iso(initial+99)},initial+4),false)
  assert.equal(fresh({...snap,lastSuccessfulFetchAt:'invalid'},initial),false)
})
test('C08, S04 · importing restores editable geometry and clears freshness and review',()=>{
  const obj={schema:1,name:'지도',address:geo.place.address,geo,origin:'osm',spec:{ink:'#393334',items:[]},review:{status:'checked'},expiresAt:iso(initial+DAY)}
  const p=importProject(JSON.stringify(obj));assert.deepEqual(p.geo,geo);assert.equal(p.imported,true);assert.deepEqual(p.review,pending());assert.equal(p.lastSuccessfulFetchAt,null)
  assert.throws(()=>importProject(JSON.stringify({...obj,external:'external'})))
  assert.throws(()=>importProject(JSON.stringify({...obj,geo:{...geo,place:{...geo.place,lat:123}}})))
  assert.throws(()=>importProject(JSON.stringify({...obj,spec:{ink:'#000000',items:[{kind:'svg'}]}})))
  assert.throws(()=>importProject(' '.repeat(5*1024*1024+1)))
})
test('S03 · a rejected lookup cannot retry automatically or promote a snapshot',async()=>{
  const original=globalThis.fetch;let calls=0
  try{
    globalThis.fetch=async()=>{calls++;return new Response(null,{status:403})}
    const result=await resolveSnapshot(snap,true,()=>fetchGeography(geo.place,new AbortController().signal))
    assert.equal(calls,1);assert.equal(result.state,'failed');assert.equal(result.snap,snap)
  }finally{globalThis.fetch=original}
})

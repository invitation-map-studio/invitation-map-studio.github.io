import assert from 'node:assert/strict'
import test from 'node:test'
import { localRoadItems, selectLocalRoads } from '../src/geography'
import { mapScale } from '../src/location-check'
import { baseItem, type Place, type Spec } from '../src/model'
import type { LocalRoad } from '../src/local-roads'

const place: Place = { id:'node/1', address:'예시로 25', lon:127, lat:37.5, radius:350, entrance:'address' }
const spec: Spec = { layout:'minimal', ink:'#454545', items:[] }
const axes = mapScale(place)
const roads: LocalRoad[] = [
  { id:1, name:'예시로', foot:false, points:[[600,550],[600,700]] },
  { id:2, name:'', foot:true, points:[[780,550],[780,700]] },
  { id:3, name:'', foot:true, points:[[910,550],[910,700]] },
]

test('네이버 참조점 인근에 빠진 보행로만 추가하고 재대조 시 중복되지 않는다', () => {
  const initial = localRoadItems(spec, place, selectLocalRoads(spec, place, roads,'예시로'), '예시로')
  assert.ok(initial.some(i => i.id.startsWith('local-addr-lane-1-')))
  assert.ok(initial.some(i => i.id.startsWith('local-foot-2-')))
  assert.ok(!initial.some(i => i.id.startsWith('local-foot-3-')))
  const paper = {...spec, items:initial}
  const selected = selectLocalRoads(paper, place, roads, '예시로', [place.lon + 150/axes.x,place.lat])
  const extra = localRoadItems(paper, place, selected, '예시로')
  assert.deepEqual(extra.map(i => i.id), ['local-foot-3-0'])
  paper.items.push(...extra)
  assert.deepEqual(localRoadItems(paper, place, selected, '예시로'), [])
  assert.deepEqual(selectLocalRoads(paper, place, roads, '예시로', [128,38]), [])
})

test('기존 큰길은 중복하지 않고 프레임 밖을 우회하는 길 사이에 선을 긋지 않는다', () => {
  const paper: Spec = {...spec, items:[{...baseItem('road-1-0'),kind:'line',width:3,points:[[600,550],[600,700]]}]}
  const rows: LocalRoad[] = [roads[0], {id:4, name:'', foot:true, points:[[300,300],[300,80],[900,80],[900,300]]}]
  const lines = localRoadItems(paper,place,rows,'')
  assert.deepEqual(lines.map(i=>i.id), ['local-foot-4-0','local-foot-4-1'])
  assert.ok(lines.every(i=>i.kind==='line' && i.points[0][0]===i.points.at(-1)![0]))
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildingItems, layout } from '../src/geography'
import type { Building } from '../src/buildings'
import type { Geography, Label, Point, Spec } from '../src/model'

const fixture = JSON.parse(readFileSync(new URL('../data/dasan74.json', import.meta.url), 'utf8'))

// Check the interior of each text's estimated painted area, after undoing its rotation.
function intersectsLabel(text: Label, start: Point, end: Point) {
  const angle = (text.angle * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle)
  const local = ([x, y]: Point): Point => [
    (x - text.x) * c + (y - text.y) * s,
    -(x - text.x) * s + (y - text.y) * c,
  ]
  const [a, b] = [local(start), local(end)]
  const width =
    Array.from(text.text).reduce(
      (sum, char) => sum + (/\s/.test(char) ? 0.32 : /[a-z\d]/i.test(char) ? 0.58 : 0.96),
      0,
    ) * text.size
  const rectangle = [
    [-width / 2, width / 2],
    [-text.size * 0.94, text.size * 0.13],
  ]
  let enter = 0,
    leave = 1
  for (let axis = 0; axis < 2; axis++) {
    const delta = b[axis] - a[axis]
    if (!delta) {
      if (a[axis] < rectangle[axis][0] || a[axis] > rectangle[axis][1]) return false
    } else {
      const t1 = (rectangle[axis][0] - a[axis]) / delta,
        t2 = (rectangle[axis][1] - a[axis]) / delta
      enter = Math.max(enter, Math.min(t1, t2))
      leave = Math.min(leave, Math.max(t1, t2))
    }
  }
  return enter <= leave
}

test('다산74의 주요 도로와 목적지 이름을 읽을 수 있고 일반 시설을 생략한다', () => {
  const geo: Geography = fixture.geo
  const { items } = layout(geo, fixture.name)
  const labels = items.filter(
    (i) => i.kind === 'text' && !i.footer && !['title', 'north'].includes(i.id),
  )
  assert.ok(labels.some((i) => i.kind === 'text' && i.id.startsWith('street-') && geo.roads.some(r => r.name === i.text)))
  assert.ok(labels.some((i) => i.kind === 'text' && i.text === fixture.name))
  assert.ok(!items.some(i => /^(label-|dot-)/.test(i.id)))
  assert.ok(items.some(i => i.id.startsWith('junction-')))
  for (const label of labels) {
    assert.equal(label.kind, 'text')
    if (label.kind !== 'text') continue
    for (const road of items) {
      if (road.kind !== 'line' || !road.id.startsWith('road-')) continue
      for (let i = 1; i < road.points.length; i++) {
        assert.equal(
          intersectsLabel(label, road.points[i - 1], road.points[i]),
          false,
          label.text + ' / ' + road.id,
        )
      }
    }
  }
})

test('한국프레스센터 출구 두 곳을 지도와 지도 전용 인쇄 영역에 함께 배치한다', async () => {
  const geo = JSON.parse(readFileSync(new URL('../src/samples/press-center.json', import.meta.url), 'utf8'))
  const { transitItems } = await import('../src/transit')
  const items = layout(geo, '한국프레스센터').items
  const guides = items.filter(i => i.kind === 'text' && i.id.startsWith('transit-guide-'))
  assert.deepEqual(guides.map(i => i.kind === 'text' && i.text), [
    '시청역 4번 출구  ·  1·2호선 · 도보 3분',
    '광화문역 5번 출구  ·  5호선 · 도보 8분',
  ])
  assert.ok(guides.every(i => i.kind === 'text' && !i.footer && i.y < 1140))
  assert.equal(items.filter(i => i.id.startsWith('transit-stop-')).length, 2)
  const generic = transitItems({...geo.place, id:'node/1', radius:50})
  assert.ok(generic.some(i => i.kind === 'text' && i.text.includes('시청역') && i.text.includes('지도 밖')))
  assert.ok(generic.every(i => i.kind === 'text' && !i.text.includes('도보')))
  assert.deepEqual(transitItems({...geo.place, id:'node/1', lat:33, lon:125}), [])
})

test('세 갈래 큰길만 교차로로 표시하고 입체 교차·단순 분할·골목은 생략한다', () => {
  const place = fixture.geo.place
  const point = (x: number, y: number): Point => [place.lon+x/100000, place.lat+y/100000]
  const points = [point(-145,65),point(-85,65),point(-30,65),point(-85,130)]
  const road = (id: number, nodes: number[], level = '//', highway = 'primary') => ({
    id, nodes, level, highway, name: '', version: 1, points: nodes.map(node => points[node-1]),
  })
  const roads = [road(1,[1,2]),road(2,[2,3])]
  const draw = (branch: ReturnType<typeof road>) =>
    layout({source:'osm',place,landmarks:[],roads:[...roads,branch]},'예식장').items
  assert.equal(draw(road(3,[2,4])).filter(i=>i.id.startsWith('junction-')).length,1)
  assert.equal(draw(road(3,[2,4],'1/yes/')).filter(i=>i.id.startsWith('junction-')).length,0)
  const minor = draw(road(3,[2,4],'//','service'))
  assert.ok(!minor.some(i=>i.id.startsWith('junction-') || i.id.startsWith('road-3-')))
})


test('건물 이름과 표식이 도로·예식장·사용자 편집을 피하고 같은 이름은 한 번만 그린다', () => {
  const g: Geography = fixture.geo
  const place = g.place
  const rows: Building[] = [
    ['way/1', '도서관', place.lon - 0.0011, place.lat, 1],
    ['node/2', '도서관', place.lon - 0.00112, place.lat, 2],
    [place.id, '목적지 건물', place.lon - 0.0013, place.lat, 0],
    ['way/3', '예식장', place.lon + 0.0013, place.lat, 0],
  ]
  const drawing: Spec = { layout: 'minimal', ink: '#333333', items: [] }
  const items = buildingItems(drawing, place, '예식장', rows)
  assert.deepEqual(items.map(i => i.id), ['building-mark-way/1', 'building-name-way/1'])
  const marker = items[0]
  assert.ok(marker.kind === 'dot')
  drawing.items.push({...marker, id: 'transit-stop-A', radius: 20})
  assert.deepEqual(buildingItems(drawing, place, '예식장', rows), [])
  drawing.items = [{ kind: 'line', id:'road-1-0', tone:'soft', footer:false, hidden:false,
    width:3, points:[[marker.x-20,marker.y], [marker.x+20,marker.y]] }]
  assert.deepEqual(buildingItems(drawing, place, '예식장', rows), [])
})

test('미등록 주소에서도 출구 소속 역·호선과 실제 출구 좌표로 가장 가까운 번호를 선택한다', async () => {
  const { transitItems } = await import('../src/transit')
  const { mapScale } = await import('../src/location-check')
  const place = { id:'node/1', address:'시험 주소', lon:127.0554556, lat:37.5201877, radius:350, entrance:'address' }
  const rows = transitItems(place)
  const marker = rows.find(i => i.id === 'transit-stop-A')
  const axes = mapScale(place)
  assert.ok(marker?.kind === 'dot')
  assert.ok(Math.abs(marker.x - (axes.cx + (127.0552336 - place.lon) * axes.x)) < 0.01)
  assert.ok(Math.abs(marker.y - (axes.cy - (37.5198424 - place.lat) * axes.y)) < 0.01)
  assert.ok(rows.some(i => i.kind === 'text' && /청담역 12번 출구.*7호선.*직선 약 40m/.test(i.text)))
  const { exits } = (await import('../src/stations.json')).default
  const other = exits.find(row => row[1] === '청담' && row[2] === '3')!
  const changed = transitItems({ ...place, lon:Number(other[3]), lat:Number(other[4]) })
  assert.ok(changed.some(i => i.kind === 'text' && /청담역 3번 출구.*0m/.test(i.text)))
})

test('근거리 약도는 가까운 출구 이름을 도면에 남기고 먼 역 때문에 범위를 넓히지 않는다', async () => {
  const { stationRadius } = await import('../src/transit')
  const place = { id: 'node/1', address: '서울특별시 강남구 학동로 519',
    lon: 127.0554556, lat: 37.5201877, radius: 1500, entrance: 'address' }
  place.radius = stationRadius(place)
  assert.equal(place.radius, 155)
  const map = layout({ source: 'osm', place, roads: [], landmarks: [] }, '예식장')
  assert.equal(map.style, 'vicinity')
  assert.ok(map.items.some(i => i.id === 'transit-exit-A' && i.kind === 'text' && i.text === '청담역 12번 출구'))
  assert.ok(!map.items.some(i => i.id === 'transit-guide-B'))

  const suburban = { ...fixture.geo.place, radius: 1500 }
  suburban.radius = stationRadius(suburban)
  assert.ok(suburban.radius <= 260)
  const suburbMap = layout({ ...fixture.geo, place: suburban }, fixture.name)
  assert.ok(suburbMap.items.some(i => i.id === 'transit-guide-A' && i.kind === 'text' && /다산역.*직선 약.*지도 밖/.test(i.text)))
  assert.ok(!suburbMap.items.some(i => i.id.startsWith('transit-stop-')))
})

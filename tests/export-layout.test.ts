import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { layout } from '../src/geography'
import type { Geography, Label, Point } from '../src/model'

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
  assert.ok(labels.some((i) => i.kind === 'text' && i.text === '미금로'))
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
    'A   시청역 4번 출구  ·  1·2호선 · 도보 3분',
    'B   광화문역 5번 출구  ·  5호선 · 도보 8분',
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

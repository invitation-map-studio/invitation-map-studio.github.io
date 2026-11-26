import assert from 'node:assert/strict'
import test from 'node:test'
import { gridPoint, gridRoads } from '../src/orthogonal'
import { displayItems } from '../src/render'
import type { Road, Point, Item, Spec } from '../src/model'

function road(id: number, points: Point[]): Road {
  return {id, name:'예식장길', version:1, highway:'secondary', level:'0', nodes:[], points}
}

test('직각형은 같은 이름의 끊어진 도로 사이에 연결선을 만들지 않는다', () => {
  const {paths, angle} = gridRoads([
    road(1, [[300,600],[550,600]]),
    road(2, [[800,600],[1050,600]]),
  ], p => p, [], '예식장길')
  assert.equal(angle, 0)
  assert.equal(paths.length, 4)
  for (const {points:[a,b]} of paths) {
    assert.equal(a[1], b[1])
    assert.ok(b[0] < 700 || a[0] > 700)
  }
})

test('기울어진 주소 도로와 함께 회전한 표식은 지도 대조 시 원좌표로 복원된다', () => {
  const {angle, paths} = gridRoads([road(1, [[290,510],[900,650]])], p => p, [], '예식장길')
  assert.ok(Math.abs(angle) > .1)
  assert.ok(paths.length > 0 && paths.every(({points:[a,b]}) => a[1] === b[1]))
  const point: Point = [450,310]
  const restored = gridPoint(gridPoint(point, angle), angle, true)
  assert.ok(Math.hypot(restored[0] - point[0], restored[1] - point[1]) < 1e-9)
})

test('도착지에 가까운 짧은 굴곡이 가로 간선도로 전체를 세로 토막으로 바꾸지 않는다', () => {
  const address = {...road(1, [[700,230],[700,970]]), name:'세종대로'}
  const bent = {...road(2, [[700,605],[700,583],[1100,583]]), name:'청계천로'}
  const {paths} = gridRoads([address,bent], p => p, [], address.name)
  const branch = paths.filter(path => path.road.id === bent.id)
  assert.ok(branch.some(({points:[a,b]}) => a[1] === b[1] && b[0]-a[0] > 280))
})

test('같은 교차로에서 양쪽으로 뻗은 이름이 다른 도로는 함께 표시한다', () => {
  const west = {...road(1, [[160,400],[700,400]]), name:'새문안로'}
  const east = {...road(2, [[700,400],[1230,400]]), name:'종로'}
  const {paths} = gridRoads([west,east], p => p, [], west.name)
  assert.deepEqual(new Set(paths.map(p => p.road.name)), new Set([west.name,east.name]))
})

test('다리로 분류된 구간도 실제 양 끝 노드에서 같은 도로로 이어진다', () => {
  const roads = [
    {...road(1, [[160,580],[460,600]]), nodes:[1,2]},
    {...road(2, [[460,600],[740,630]]), nodes:[2,3], level:'1/yes/'},
    {...road(3, [[740,630],[1080,650]]), nodes:[3,4]},
  ]
  const {paths,angle} = gridRoads(roads,p => p,[],roads[0].name)
  const bridgeX = gridPoint([600,615],angle)[0]
  assert.equal(paths.filter(({points:[a,b]}) => a[1] === b[1] && a[0]<bridgeX && bridgeX<b[0]).length, 2)
})

test('같은 도로가 직각으로 꺾이는 곳은 두 외곽선이 각각 모서리에서 만난다', () => {
  const bend = {...road(1,[[330,605],[700,605],[700,930]]), nodes:[1,2,3]}
  const {paths} = gridRoads([bend],p => p,[],bend.name)
  const horizontal = paths.filter(({points:[a,b]}) => a[1] === b[1])
  const vertical = paths.filter(({points:[a,b]}) => a[0] === b[0])
  assert.equal(horizontal.length,2)
  assert.equal(vertical.length,2)
  for (const h of horizontal)
    assert.ok(vertical.some(v => v.points[0].every((n,i) => Math.abs(n-h.points[1][i])<.01)))
})

test('한 줄 도로는 모서리에서 만나고 기존 저장본에서도 같은 위치에 표시된다', () => {
  const bend = {...road(1,[[330,605],[700,605],[700,930]]), nodes:[1,2,3]}
  const {angle,paths,centers} = gridRoads([bend],p => p,[],bend.name)
  const rails: Item[] = paths.map(({points},i) => ({
    id:'road-1-'+i, kind:'line', points, width:4, tone:'soft', footer:false, hidden:false,
  }))
  const marker: Item = {id:'destination',kind:'flower',x:600,y:600,radius:15,tone:'ink',footer:false,hidden:false}
  const spec: Spec = {items:[...rails,marker],gridAngle:angle,ink:'#111111'}
  const native = centers.map(({points:[a,b]}): [Point,Point] => [a,b])
  assert.equal(native.length,2)
  assert.deepEqual(native[0][1],native[1][0])
  for (const roadCenters of [undefined,native]) {
    const single = displayItems({...spec,singleRoads:true,roadCenters})
    assert.deepEqual(single.flatMap(i => i.kind==='line' && i.width===2.8 ? [i.points] : []),native)
    assert.equal(single.at(-1),marker)
    assert.deepEqual(displayItems({...spec,singleRoads:false,roadCenters}),spec.items)
  }
})

test('이름이 다른 지하차도 양 끝이 같은 도로에 연결되면 한 줄과 두 줄 모두 직선으로 정렬한다', () => {
  const street = (id:number, points:Point[], nodes:number[]) => ({...road(id,points),nodes})
  const north = street(1,[[430,240],[411,500]],[1,2])
  const south = street(2,[[426,548],[468,950]],[4,5])
  const tunnel = [
    {...street(3,[[411,500],[420,522]],[2,3]),name:'역지하차도',level:'-1//yes'},
    {...street(4,[[420,522],[426,548]],[3,4]),name:'역지하차도',level:'-1//yes'},
  ]
  const grid = (ways: Road[]) => gridRoads([north,south,...ways],p=>p,[],north.name)
  const connected = grid(tunnel)
  assert.equal(connected.centers.length,1)
  assert.equal(connected.paths.length,2)
  const [a,b] = connected.centers[0].points
  assert.equal(a[0],b[0])
  assert.ok(b[1]-a[1]>550)
  for (const rail of connected.paths) {
    assert.equal(rail.points[0][0],rail.points[1][0])
    assert.equal(Math.abs(rail.points[0][0]-a[0]),7)
  }
  const broken = grid([tunnel[0],{...tunnel[1],nodes:[3,99]}])
  assert.equal(broken.centers.length,2)
  assert.notEqual(broken.centers[0].points[0][0],broken.centers[1].points[0][0])
})

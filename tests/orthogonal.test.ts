import assert from 'node:assert/strict'
import test from 'node:test'
import { gridPoint, gridRoads } from '../src/orthogonal'
import type { Road, Point } from '../src/model'

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

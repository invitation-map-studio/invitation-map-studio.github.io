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

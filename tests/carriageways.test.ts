import assert from 'node:assert/strict'
import test from 'node:test'
import { streetCenterline } from '../src/carriageways'
import type { Point } from '../src/model'

const edge = (a: Point, b: Point) => ({a,b,length:Math.hypot(a[0]-b[0],a[1]-b[1])})

test('분리 차도는 실제 두 방향 사이에 한 줄을 그리고 다른 평행 도로와 갈라지는 길은 유지한다', () => {
  const left = edge([0,0],[200,0])
  const right = edge([200,20],[0,20])
  const center = streetCenterline([left,right],1)
  assert.ok(center && center.every(([,y]) => y === 10))
  assert.equal(streetCenterline([left,edge([0,20],[200,20])],1), undefined)
  assert.equal(streetCenterline([left,edge([200,90],[0,90])],1), undefined)
  assert.equal(streetCenterline([left,right,edge([110,0],[105,100])],1), undefined)
  assert.equal(streetCenterline([left],1), undefined)
})

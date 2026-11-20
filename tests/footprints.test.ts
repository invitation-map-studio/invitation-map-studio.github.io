import assert from 'node:assert/strict'
import test from 'node:test'
import { containingBuildings } from '../src/footprints'

test('건물 외곽과 중정을 구별하고 독립 도형에서 동일한 인쇄 대표점을 선택한다', () => {
  const outer = [0,0,100,0,100,100,0,100]
  const courtyard = [30,30,70,30,70,70,30,70]
  const lookup = (x: number, y: number) => containingBuildings([['w123',12700000,3700000,[outer,courtyard]]],
    [127+x/1e5,37+y/1e5], '테스트로 1')
  assert.deepEqual(lookup(50,50),[])
  assert.deepEqual(lookup(110,40),[])
  assert.deepEqual(lookup(10,20),lookup(90,80))
  const [place] = lookup(10,20)
  assert.equal(place.id,'way/123')
  assert.equal(place.lat,37.0005)
  assert.equal(place.lon,127.00015)
})

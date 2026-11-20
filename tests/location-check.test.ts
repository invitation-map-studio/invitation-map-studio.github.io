import test from 'node:test'
import assert from 'node:assert/strict'
import geo from '../src/samples/press-center.json'
import { layout } from '../src/geography'
import { compareNaverAddress, localLocationCheck, markerPoint } from '../src/location-check'
import { pending, type Geography, type Project } from '../src/model'

const data = geo as Geography
function pressCenter(): Project {
  return { schema: 1, id: 'press', name: '한국프레스센터', origin: 'osm', address: data.place.address,
    geo: data, spec: layout(data, '한국프레스센터'), lastSuccessfulFetchAt: null, expiresAt: null,
    lastAccessedAt: '', imported: false, review: pending() }
}
test('기관 주소, 실제 표시 도로, 현재 꽃 표식을 대조하고 좌표 차이를 밝힌다', () => {
  const p = pressCenter()
  assert.match(localLocationCheck(p)!.message, /한국프레스센터.*세종대로 도로 표시 확인.*대표점과 일치.*123m 차이/)
  const flower = p.spec.items.find(i => i.kind === 'flower')!
  if (flower.kind !== 'flower') throw Error('꽃 없음')
  flower.x += 440
  assert.match(localLocationCheck(p)!.message, /350m 이동/)
  flower.hidden = true
  assert.equal(markerPoint(p), undefined)
  p.imported = true
  assert.equal(localLocationCheck(p), undefined)
})
test('네이버 도로명주소와 표식 좌표의 차이를 독립적으로 확인한다', () => {
  const p = pressCenter(), marker = markerPoint(p)!
  assert.match(compareNaverAddress(p.address, '서울 중구 세종대로 124', marker, marker), /도로명주소 일치.*0m/)
  assert.match(compareNaverAddress(p.address, '서울 중구 세종대로 110', marker, marker), /일치 여부 확인 필요/)
  assert.match(compareNaverAddress(p.address, p.address, [marker[0], marker[1]+0.001], marker), /50m 초과/)
  assert.match(compareNaverAddress(p.address, '', marker, marker), /일치 여부 확인 필요/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoadAddress, mentionsVenue, matchesRegion } from '../src/road-address'

test('도로명 검색은 지번동·시설·층수 안내를 분리하고 원래 상세 문구를 보존한다', () => {
  const base = '가람시 바람길 124'
  for (const suffix of [
    ' (가람동, 예시회관 19~20층)',
    '(가람동)',
    ', 예시회관 19층',
    ' 예시회관 20층',
  ]) {
    const parsed = parseRoadAddress(base + suffix)
    assert.equal(parsed.address, base)
    assert.equal(parsed.street, '바람길')
    assert.equal(parsed.number, '124')
    assert.equal(parsed.details, suffix.replace(/^[\s,]+/, ''))
  }
  assert.equal(parseRoadAddress('바람길 124-2').number, '124-2')
  assert.equal(parseRoadAddress('바람길 124').details, '')
  for (const bad of ['바람길', '바람길 124-', '바람길 124층'])
    assert.throws(() => parseRoadAddress(bad))
  assert.ok(mentionsVenue('(가람동, 예시회관 19~20층)', '예시회관'))
  assert.equal(mentionsVenue('(예시회관점)', '예시회관'), false)
})

test('주소 후보의 지역을 확인하고 생략된 행정구역은 허용한다', () => {
  assert.ok(matchesRegion('서울 강남구 테헤란로 610', '서울특별시 강남구'))
  assert.ok(matchesRegion('서울 강남구 테헤란로 610', '강남구'))
  assert.equal(matchesRegion('부산 중구 중앙대로 10', '서울특별시 중구'), false)
  assert.equal(matchesRegion('경기도 광주시 중앙로 10', '광주광역시'), false)
})

test('시 이름의 약칭과 나뉘어 입력된 도로명을 정식 주소로 찾는다', () => {
  for (const raw of ['남양주 다산 중앙로 82번 안길 74', '남양주시 다산중앙로 82 번 안길 74']) {
    assert.deepEqual(parseRoadAddress(raw + ' (1층 안내)'), {
      address: '남양주시 다산중앙로82번안길 74', street: '다산중앙로82번안길', number: '74', details: '(1층 안내)',
    })
  }
  assert.equal(parseRoadAddress('남양주 다산 중앙로 82').address, '남양주시 다산중앙로 82')
  assert.equal(parseRoadAddress('서울 중구 세종 대로 124-1').address, '서울 중구 세종대로 124-1')
  assert.equal(parseRoadAddress('가평 설악면 유명 로 12').address, '가평군 설악면 유명로 12')
  assert.throws(() => parseRoadAddress('길 74'))
})

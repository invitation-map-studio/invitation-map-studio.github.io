import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoadAddress, mentionsVenue } from '../src/road-address'

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

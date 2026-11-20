import { normalize } from './model'

// Keep venue, floor and unit details local. Only the civic address identifies the map data.
export function parseRoadAddress(input: string) {
  const value = normalize(input)
  const match =
    /(?:^|\s)([가-힣a-zA-Z0-9·.]+(?:길|로))\s+(\d{1,5}(?:-\d{1,5})?)(?=$|[\s,(（])/.exec(value)
  if (!match) throw Error('도로명과 건물번호를 입력해 주세요. 예: 세종대로 124')
  const end = match.index + match[0].length
  return {
    address: value.slice(0, end),
    street: match[1],
    number: match[2],
    details: value.slice(end).replace(/^[\s,]+/u, ''),
  }
}

export function mentionsVenue(details: string, name: string) {
  return details
    .split(/[(),（）]/u)
    .some(
      (part) =>
        part.trim() === name ||
        (part.trim().startsWith(name + ' ') &&
          /^(?:지하\s*)?\d+(?:\s*[~～–-]\s*\d+)?\s*층(?:\s|$)/u.test(
            part.trim().slice(name.length).trim(),
          )),
    )
}

const provinces = [
  ['서울특별시', '서울', '서울시'], ['부산광역시', '부산', '부산시'], ['대구광역시', '대구', '대구시'],
  ['인천광역시', '인천', '인천시'], ['광주광역시', '광주'], ['대전광역시', '대전', '대전시'],
  ['울산광역시', '울산', '울산시'], ['세종특별자치시', '세종', '세종시'], ['경기도', '경기'],
  ['강원특별자치도', '강원도', '강원'], ['충청북도', '충북'], ['충청남도', '충남'],
  ['전북특별자치도', '전북', '전라북도'], ['전라남도', '전남'], ['경상북도', '경북'],
  ['경상남도', '경남'], ['제주특별자치도', '제주도', '제주'],
]
export function canonicalAddress(address: string) {
  const [first, ...rest] = normalize(address).split(' ')
  const province = provinces.find(names => names.includes(first))
  return [province?.[0] ?? first, ...rest].join(' ')
}

// OSM records may give only part of the region. Reject a known conflict.
export function matchesRegion(address: string, area: string) {
  const expected = canonicalAddress(address).split(' '), actual = canonicalAddress(area).split(' ')
  const provinceNames = provinces.map(([full]) => full)
  if (provinceNames.includes(expected[0]) && provinceNames.includes(actual[0]) &&
      expected[0] !== actual[0]) return false
  const cityOrDistrict = (words: string[], ending: RegExp) =>
    words.filter(word => !provinceNames.includes(word) && ending.test(word))
  for (const suffix of [/시$/, /군$/, /구$/]) {
    const given = cityOrDistrict(expected, suffix), known = cityOrDistrict(actual, suffix)
    if (given.length && known.length && !given.some(word => known.includes(word))) return false
  }
  return true
}

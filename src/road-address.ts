import municipalityNames from './municipalities.json'
import { normalize } from './model'

// Keep venue, floor and unit details local. Only the civic address identifies the map data.
export function parseRoadAddress(input: string) {
  const value = normalize(input.replace(/&#(?:x20|32);/gi, ' '))
  const candidates = value.matchAll(/(?:^|\s)([가-힣a-zA-Z0-9·.]*(?:길|로))\s+(\d{1,5}(?:-\d{1,5})?)(?=$|[\s,(（])/g)
  let match
  for (const candidate of candidates) {
    const after = value.slice(candidate.index! + candidate[0].length)
    if (/^\s+(?:번\s*)?[가-힣]{0,3}길\s+\d/.test(after)) continue
    match = candidate
    break
  }
  if (!match) throw Error('도로명과 건물번호를 입력해 주세요. 예: 세종대로 124')
  const end = match.index! + match[0].length
  const tokens = value.slice(0, end).split(' ')
  const number = tokens.pop()!
  const region: string[] = []
  while (tokens.length > 1) {
    const token = tokens[0]
    if (tokens.length === 2 && /^(?:대로|로|길)$/.test(tokens[1])) break
    const city = shortMunicipalities.get(token)
    const province = !region.length && provinces.some(names => names.includes(token))
    if (!city && !province && !/[시군구읍면동리]$/.test(token)) break
    region.push(city ?? token)
    tokens.shift()
  }
  const street = tokens.join('')
  if (!/^[가-힣a-zA-Z0-9·.]+(?:길|로)$/.test(street))
    throw Error('도로명과 건물번호를 입력해 주세요. 예: 세종대로 124')
  return {
    address: [...region, street, number].join(' '),
    street,
    number,
    details: value.slice(end).replace(/^[\s,]+/u, '').replace(/^#{1,6}\s+/, ''),
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
const regionNames = new Set([...municipalityNames, ...provinces.flat()])
const shortMunicipalities = new Map<string, string>()
for (const city of municipalityNames.filter(name => /[시군]$/.test(name))) {
  const short = city.slice(0, -1)
  if (!regionNames.has(short)) shortMunicipalities.set(short, city)
}

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

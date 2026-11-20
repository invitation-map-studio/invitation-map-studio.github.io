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

import { gunzipSync, strFromU8 } from 'fflate'
import { canonicalAddress, matchesRegion } from './road-address'
import { coordinate, type Place } from './model'

type Entry = [
  number: string,
  osmId: string,
  lat: number,
  lon: number,
  district: string,
  name: string,
]
async function streetRows<T>(folder: string, street: string, signal: AbortSignal) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(street))
  const shard = new Uint8Array(hash)[0].toString(16).padStart(2, '0')
  const url = new URL(folder + '/' + shard + '.bin', document.baseURI)
  const response = await fetch(url, { signal, credentials: 'same-origin' })
  if (!response.ok) throw Error('도로명 색인 파일을 열 수 없습니다.')
  const data: Record<string, T[]> = JSON.parse(
    strFromU8(gunzipSync(new Uint8Array(await response.arrayBuffer()))),
  )
  return Object.hasOwn(data, street) ? data[street] : []
}

export async function indexedAddresses(
  address: string,
  street: string,
  number: string,
  signal: AbortSignal,
) {
  const rows = await streetRows<Entry>('address-index', street, signal)
  return rows.flatMap(([house, osmId, lat, lon, district, name]) => {
    if (house !== number || !coordinate(lat, lon) || !matchesRegion(address, district)) return []
    const type = ({ n: 'node', w: 'way', r: 'relation' } as Record<string, string>)[osmId[0]]
    if (!type || !/^\d+$/.test(osmId.slice(1))) return []
    const place: Place & { display: string; venueName: string } = {
      address,
      id: type + '/' + osmId.slice(1),
      lat,
      lon,
      radius: 350,
      entrance: 'address',
      venueName: name,
      display: [name, district].filter(Boolean).join(' · '),
    }
    return [place]
  })
}

export async function commercialAddresses(address: string, street: string, number: string, signal: AbortSignal) {
  type CommercialRow = [string, string, number, number, string]
  const rows = await streetRows<CommercialRow>('commercial-addresses', street, signal)
  const regionTokens = canonicalAddress(address).split(' ').slice(0, -2)
  return rows.flatMap(([house, region, y, x, name]) => {
    const area = canonicalAddress(region).split(' ')
    if (house !== number || !regionTokens.every(token => area.includes(token))) return []
    const fullAddress = [...area, street, house].join(' ')
    return [{ address: fullAddress, id: 'sbiz/' + x + '/' + y, lon: x / 1e5, lat: y / 1e5,
      entrance: 'commercial-address', radius: 350, venueName: name, display: name || fullAddress }]
  })
}

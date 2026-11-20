import { gunzipSync, strFromU8 } from 'fflate'
import { coordinate, type Place } from './model'

type Entry = [
  number: string,
  osmId: string,
  lat: number,
  lon: number,
  district: string,
  name: string,
]
export async function indexedAddresses(
  address: string,
  street: string,
  number: string,
  signal: AbortSignal,
) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(street))
  const shard = new Uint8Array(hash)[0].toString(16).padStart(2, '0')
  const url = new URL('address-index/' + shard + '.bin', document.baseURI)
  const response = await fetch(url, { signal, credentials: 'same-origin' })
  if (!response.ok) throw Error('도로명 색인 파일을 열 수 없습니다.')
  const data: Record<string, Entry[]> = JSON.parse(
    strFromU8(gunzipSync(new Uint8Array(await response.arrayBuffer()))),
  )
  const rows = Object.hasOwn(data, street) ? data[street] : []
  return rows.flatMap(([house, osmId, lat, lon, district, name]) => {
    if (house !== number || !coordinate(lat, lon)) return []
    const type = ({ n: 'node', w: 'way', r: 'relation' } as Record<string, string>)[osmId[0]]
    if (!type || !/^\d+$/.test(osmId.slice(1))) return []
    const place: Place & { display: string } = {
      address,
      id: type + '/' + osmId.slice(1),
      lat,
      lon,
      radius: 350,
      entrance: 'address',
      display: [name, district].filter(Boolean).join(' · '),
    }
    return [place]
  })
}

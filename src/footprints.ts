import { gunzipSync, strFromU8 } from 'fflate'
import type { Place, Point } from './model'

type Footprint = [id: string, west: number, south: number, rings: number[][]]

function inside(x: number, y: number, ring: number[]) {
  let crosses = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[i], ay = ring[i + 1], bx = ring[j], by = ring[j + 1]
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) crosses = !crosses
  }
  return crosses
}

// Use the live reference only to select an independent building. Its print marker
// is the midpoint of an interior scan-line of the OSM polygon, including courtyards.
export function containingBuildings(rows: Footprint[], [lon, lat]: Point, address: string): Place[] {
  const results = new Map<string, Place>()
  for (const [id, west, south, rings] of rows) {
    const x = lon * 1e5 - west, y = lat * 1e5 - south
    if (x < 0 || y < 0 || !inside(x, y, rings[0]) || rings.slice(1).some(ring => inside(x, y, ring))) continue
    const ys = rings[0].filter((_, i) => i % 2 === 1)
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2
    const cuts: number[] = []
    for (const ring of rings) for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const ay = ring[i + 1], by = ring[j + 1]
      if ((ay > midY) !== (by > midY)) cuts.push(ring[i] + (midY - ay) * (ring[j] - ring[i]) / (by - ay))
    }
    cuts.sort((a,b) => a - b)
    let longest = 0, midX = 0
    for (let i = 1; i < cuts.length; i += 2) if (cuts[i] - cuts[i - 1] > longest) {
      longest = cuts[i] - cuts[i - 1]
      midX = (cuts[i] + cuts[i - 1]) / 2
    }
    if (longest) results.set(id, { address, id: (id[0] === 'w' ? 'way/' : 'relation/') + id.slice(1),
      lon: (west + midX) / 1e5, lat: (south + midY) / 1e5, entrance: 'mapped-building', radius: 350 })
  }
  return [...results.values()]
}

export async function buildingsAtReference(point: Point, address: string, signal: AbortSignal) {
  const tile = point.map(value => Math.floor(value * 8)).join('-')
  const url = new URL('footprints/' + tile + '.bin', document.baseURI)
  const response = await fetch(url, { signal })
  if (response.status === 404) return []
  if (!response.ok) throw Error('건물 도형 자료를 읽을 수 없습니다.')
  const content = strFromU8(gunzipSync(new Uint8Array(await response.arrayBuffer())))
  const rows = content.trimEnd().split('\n').map(line => JSON.parse(line) as Footprint)
  return containingBuildings(rows, point, address)
}

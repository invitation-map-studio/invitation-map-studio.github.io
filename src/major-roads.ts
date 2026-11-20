import { gunzipSync, strFromU8 } from 'fflate'
import { stationRadius } from './transit'
import type { Geography, Place, Road } from './model'

type Row = [number, number, string, string, string, [number, number, number][]]
type Index = { tiles: string[]; sourceTime: string }

// Find complete ways within the print area, including a long segment with both
// endpoints outside. Work in metres relative to the venue for numerical stability.
function crosses(x: number, y: number, dx: number, dy: number, width: number, height: number) {
  let lo = 0, hi = 1
  for (const [p, q] of [[-dx, x + width], [dx, width - x], [-dy, y + height], [dy, height - y]]) {
    if (p === 0 && q < 0) return false
    if (p < 0) lo = Math.max(lo, q / p)
    if (p > 0) hi = Math.min(hi, q / p)
  }
  return lo <= hi
}

async function read(path: string, signal: AbortSignal) {
  const response = await fetch(new URL('major-roads/' + path, document.baseURI), { signal })
  if (!response.ok) throw Error('큰길 자료를 읽을 수 없습니다.')
  return response
}

export async function indexedRoads(place: Place, signal: AbortSignal) {
  const index: Index = await (await read('index.json', signal)).json()
  const metersX = 111320 * Math.cos(place.lat * Math.PI / 180)
  const radius = stationRadius(place)
  const limit = Math.max(1500, radius)
  const available = new Set(index.tiles)
  const tiles: string[] = []
  const lonDelta = limit * 1.43 / metersX, latDelta = limit * 1.02 / 111320
  for (let x = Math.floor((place.lon - lonDelta) * 8); x <= Math.floor((place.lon + lonDelta) * 8); x++)
    for (let y = Math.floor((place.lat - latDelta) * 8); y <= Math.floor((place.lat + latDelta) * 8); y++)
      if (available.has(x + '-' + y)) tiles.push(x + '-' + y)
  const chunks = await Promise.all(tiles.map(async key => {
    const bytes = await (await read(key + '.bin', signal)).arrayBuffer()
    return JSON.parse(strFromU8(gunzipSync(new Uint8Array(bytes)))) as Row[]
  }))
  const rows = new Map<number, { road: Road; radius: number }>()
  // Enlarge sparse maps until at least one major road fits. Dense areas keep the
  // closer scale. Preserve original node IDs and coordinates for true junctions.
  const radii = [...new Set([radius, Math.max(radius, 700), Math.max(radius, 1000), limit])]
  for (const chunk of chunks) for (const [id, version, name, highway, level, nodes] of chunk) {
    if (rows.has(id)) continue
    const offsets = nodes.map(([, x, y]) => [(x / 1e7 - place.lon) * metersX, (y / 1e7 - place.lat) * 111320])
    const fits = radii.find(r => offsets.some(([x, y], i) => i > 0 && crosses(
      offsets[i - 1][0], offsets[i - 1][1], x - offsets[i - 1][0], y - offsets[i - 1][1], r * 1.4, r,
    )))
    if (fits === undefined) continue
    rows.set(id, { radius: fits, road: { id, version, name, highway, level,
      nodes: nodes.map(n => n[0]), points: nodes.map(([, x, y]) => [x / 1e7, y / 1e7]) } })
  }
  const found = [...rows.values()]
  if (!found.length) return
  const frame = Math.min(...found.map(r => r.radius))
  const geo: Geography = { source: 'osm', place: { ...place, radius: frame }, landmarks: [],
    roads: found.filter(r => r.radius <= frame).map(r => r.road).sort((a, b) => a.id - b.id) }
  return { geo, fetchedAt: index.sourceTime }
}

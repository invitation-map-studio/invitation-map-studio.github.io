import { gunzipSync, strFromU8 } from 'fflate'
import { stationRadius } from './transit'
import type { Geography, Place, Road } from './model'

type Row = [number, number, string, string, string, [number, number, number][], number?, ([number, number, string][])?]
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
  const response = await fetch(new URL('major-roads/' + path + '?v=2', document.baseURI), { signal })
  if (!response.ok) throw Error('큰길 자료를 읽을 수 없습니다.')
  return response
}

export async function indexedRoads(place: Place, signal: AbortSignal) {
  const index: Index = await (await read('index.json', signal)).json()
  const metersX = 111320 * Math.cos(place.lat * Math.PI / 180)
  const radius = stationRadius(place)
  const available = new Set(index.tiles)
  const tiles: string[] = []
  const lonDelta = radius * 1.43 / metersX, latDelta = radius * 1.02 / 111320
  for (let x = Math.floor((place.lon - lonDelta) * 8); x <= Math.floor((place.lon + lonDelta) * 8); x++)
    for (let y = Math.floor((place.lat - latDelta) * 8); y <= Math.floor((place.lat + latDelta) * 8); y++)
      if (available.has(x + '-' + y)) tiles.push(x + '-' + y)
  const chunks = await Promise.all(tiles.map(async key => {
    const bytes = await (await read(key + '.bin', signal)).arrayBuffer()
    return JSON.parse(strFromU8(gunzipSync(new Uint8Array(bytes)))) as Row[]
  }))
  const rows = new Map<number, Road>()
  const landmarks = new Map<number, Geography['landmarks'][number]>()
  for (const chunk of chunks) for (const [id, version, name, highway, level, nodes, oneWay, junctions] of chunk) {
    if (rows.has(id)) continue
    const offsets = nodes.map(([, x, y]) => [(x / 1e7 - place.lon) * metersX, (y / 1e7 - place.lat) * 111320])
    const fits = offsets.some(([x, y], i) => i > 0 && crosses(
      offsets[i - 1][0], offsets[i - 1][1], x - offsets[i - 1][0], y - offsets[i - 1][1], radius * 1.42, radius * 1.02,
    ))
    if (!fits) continue
    for (const [ref, revision, title] of junctions ?? []) {
      const node = nodes.find(n => n[0] === ref)
      if (node) landmarks.set(ref, {id: 'node/' + ref, version: revision, kind: 'junction', name: title, point: [node[1]/1e7, node[2]/1e7]})
    }
    rows.set(id, { id, version, name, highway, level, ...(oneWay ? {oneWay: true} : {}),
      nodes: nodes.map(n => n[0]), points: nodes.map(([, x, y]) => [x / 1e7, y / 1e7]) })
  }
  if (!rows.size) return
  const geo: Geography = { source: 'osm', place: { ...place, radius }, landmarks: [...landmarks.values()],
    roads: [...rows.values()].sort((a, b) => a.id - b.id) }
  return { geo, fetchedAt: index.sourceTime }
}

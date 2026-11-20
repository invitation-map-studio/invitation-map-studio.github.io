import { gunzipSync, strFromU8 } from 'fflate'
import type { Place, Point } from './model'
import { mapScale } from './location-check'
import { mapBounds } from './transit'

type Row = [id: number, name: string, foot: number, coords: number[]]
export type LocalRoad = { id: number; name: string; foot: boolean; points: Point[] }

let lastFrame: { key: string; roads: LocalRoad[] } | undefined

// Keep only geometry in the printable frame. Points use the same projection as the major roads.
export async function localRoadsNear(place: Place, signal: AbortSignal): Promise<LocalRoad[]> {
  signal.throwIfAborted()
  const key = JSON.stringify([place.lon, place.lat, place.radius])
  if (lastFrame?.key === key) return lastFrame.roads
  const read = async (file: string) => {
    const res = await fetch(new URL('local-roads/' + file, document.baseURI), { signal })
    if (!res.ok) throw Error('골목·보행로 자료를 불러오지 못했습니다.')
    return res
  }
  const index: {tiles: string[]} = await (await read('index.json')).json()
  const tiles = new Set(index.tiles)
  const axes = mapScale(place)
  const [left, top, right, bottom] = mapBounds
  const west = place.lon + (left - axes.cx) / axes.x, east = place.lon + (right - axes.cx) / axes.x
  const north = place.lat + (axes.cy - top) / axes.y, south = place.lat + (axes.cy - bottom) / axes.y
  const chunks: Promise<ArrayBuffer>[] = []
  for (let x = Math.floor(west * 8); x <= Math.floor(east * 8); x++)
    for (let y = Math.floor(south * 8); y <= Math.floor(north * 8); y++) {
      const tile = x + '-' + y
      if (tiles.has(tile)) chunks.push(read(tile + '.bin').then(r => r.arrayBuffer()))
    }
  const found = new Map<number, LocalRoad>()
  for (const bytes of await Promise.all(chunks)) {
    const lines = strFromU8(gunzipSync(new Uint8Array(bytes))).trimEnd().split('\n')
    for (const line of lines) {
      const [id, name, foot, coords] = JSON.parse(line) as Row
      if (found.has(id)) continue
      let lon = 0, lat = 0, prevX = 0, prevY = 0, visible = false
      const points: Point[] = []
      for (let i = 0; i < coords.length; i += 2) {
        lon += coords[i]; lat += coords[i + 1]
        const x = axes.cx + (lon / 1e6 - place.lon) * axes.x
        const y = axes.cy - (lat / 1e6 - place.lat) * axes.y
        if (i && Math.max(prevX,x) >= left && Math.min(prevX,x) <= right &&
            Math.max(prevY,y) >= top && Math.min(prevY,y) <= bottom) visible = true
        prevX = x; prevY = y
        points.push([x, y])
      }
      if (visible) found.set(id, {id, name, foot: Boolean(foot), points})
    }
  }
  const roads = [...found.values()]
  lastFrame = { key, roads }
  return roads
}

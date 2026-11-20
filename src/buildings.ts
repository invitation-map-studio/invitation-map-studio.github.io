import { gunzipSync, strFromU8 } from 'fflate'
import type { Place } from './model'
import { mapScale } from './location-check'
import { mapBounds } from './transit'

export type Building = [id: string, name: string, lon: number, lat: number, priority: number]

async function read(file: string, signal: AbortSignal) {
  const response = await fetch(new URL('buildings/' + file, document.baseURI), { signal })
  if (!response.ok) throw Error('주변 건물 자료를 열 수 없습니다.')
  return response
}

export async function buildingsNear(place: Place): Promise<Building[]> {
  const signal = AbortSignal.timeout(5500)
  const { tiles }: { tiles: string[] } = await (await read('index.json', signal)).json()
  const axes = mapScale(place)
  const [left, top, right, bottom] = mapBounds
  const west = place.lon + (left - axes.cx) / axes.x, east = place.lon + (right - axes.cx) / axes.x
  const north = place.lat + (axes.cy - top) / axes.y, south = place.lat + (axes.cy - bottom) / axes.y
  const requests: Promise<Building[]>[] = []
  for (let x = Math.floor(west * 4); x <= Math.floor(east * 4); x++)
    for (let y = Math.floor(south * 4); y <= Math.floor(north * 4); y++) {
      const key = x + '-' + y
      if (tiles.includes(key)) requests.push(read(key + '.bin', signal).then(async response => {
        const bytes = new Uint8Array(await response.arrayBuffer())
        const rows: Building[] = JSON.parse(strFromU8(gunzipSync(bytes)))
        return rows.filter(([, , lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north)
      }))
    }
  return (await Promise.all(requests)).flat()
}

import stationIndex from './stations.json'
import venues from './venues.json'
import { mapScale } from './location-check'
import { baseItem, label, type Item, type Place } from './model'

export const mapBounds = [76, 160, 1324, 1045] as const

type Stop = { name: string; lon: number; lat: number; directions?: string; line?: string }

export function nearbyStations(place: Pick<Place, 'lon' | 'lat'>, numbered: boolean): Stop[] {
  const metersLon = 111320 * Math.cos(place.lat * Math.PI / 180)
  type Candidate = Stop & { meters: number; id: number; exit: boolean }
  const closest = new Map<string, Candidate>()
  function consider(id: number, rawName: string, lon: number, lat: number, ref?: string, line?: string) {
    const meters = Math.hypot((lon - place.lon) * metersLon, (lat - place.lat) * 111320)
    if (meters > 2500) return
    const station = rawName.endsWith('역') ? rawName : rawName + '역'
    const prev = closest.get(station)
    const exit = ref !== undefined
    if (prev && (prev.exit && !exit || prev.exit === exit &&
        (prev.meters < meters || prev.meters === meters && prev.id <= id))) return
    closest.set(station, { id, name: exit ? station + ' ' + ref + '번 출구' : station, lon, lat, meters, exit, line })
  }
  for (const row of stationIndex.stations) {
    const [id, name, lon, lat] = row as [number, string, number, number]
    consider(id, name, lon, lat)
  }
  if (numbered) for (const row of stationIndex.exits) {
    const [id, name, ref, lon, lat, line] = row as [number, string, string, number, number, string]
    consider(id, name, lon, lat, ref, line)
  }
  const ranked = [...closest.values()].sort((a, b) => a.meters - b.meters || a.id - b.id)
  const nearby = ranked.filter(stop => stop.meters <= 1000)
  return nearby.length ? nearby.slice(0, 2) : ranked.slice(0, 1)
}

export function stationsFor(place: Place, numbered = true): Stop[] {
  const venue = venues.find(v => v.site === place.id && v.address === place.address)
  return venue?.transit.map(s => ({
    ...s, directions: s.line + ' · 도보 ' + s.minutes + '분',
  })) ?? nearbyStations(place, numbered)
}

export const closeMapZoom = 18
export const scaleBarMeters = 30

// Match the ground resolution of the Naver reference view at the document's
// native 140 mm print width. One SVG unit is 0.1 mm (96 CSS px per inch).
export function printRadius(place: Pick<Place, 'lat'>) {
  const metersPerPixel = 2 * Math.PI * 6378137 * Math.cos(place.lat * Math.PI / 180) /
    (256 * 2 ** closeMapZoom)
  return Math.round(440 * .1 * 96 / 25.4 * metersPerPixel)
}

export function transitItems(place: Place, numbered = true, vicinity = false): Item[] {
  const stops = stationsFor(place, numbered)
  const axes = mapScale(place)
  const items: Item[] = []
  for (const [i, stop] of stops.entries()) {
    const x = axes.cx + (stop.lon - place.lon) * axes.x
    const y = axes.cy - (stop.lat - place.lat) * axes.y
    const [left, top, right, bottom] = mapBounds
    const inMap = x >= left && x <= right && y >= top && y <= bottom
    if (vicinity && !inMap && i > 0 && !stop.directions) continue
    const key = String.fromCharCode(65 + i)
    const parts = [stop.name]
    if (inMap) {
      items.push({ ...baseItem('transit-stop-' + key), kind: 'dot', x, y, radius: 15 })
      if (!vicinity) parts[0] = key + '   ' + stop.name
    }
    if (stop.directions) parts.push(stop.directions)
    else {
      const meters = Math.hypot(x - axes.cx, y - axes.cy) * place.radius / 440
      if (stop.line) parts.push(stop.line)
      if (numbered && !stop.name.endsWith('번 출구')) parts.push('역 대표점 기준')
      parts.push('직선 약 ' + Math.round(meters / 10) * 10 + 'm')
    }
    if (!inMap || (vicinity && !stop.directions && Math.hypot(x - axes.cx, y - axes.cy) * place.radius / 440 >= 20)) {
      const directions = ['동', '북동', '북', '북서', '서', '남서', '남', '남동']
      const octant = Math.round(Math.atan2(axes.cy - y, x - axes.cx) / (Math.PI / 4))
      parts.push(inMap ? '목적지는 ' + directions[(12 + octant) % 8] + '쪽' :
        '지도 밖 ' + directions[(8 + octant) % 8] + '쪽')
    }
    items.push(label('transit-guide-' + key, parts.join('  ·  '), 700, 1085 + i * 38, 26, {font:'sans'}))
  }
  return items
}

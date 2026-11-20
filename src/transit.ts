import stationIndex from './stations.json'
import venues from './venues.json'
import { mapScale } from './location-check'
import { baseItem, label, type Item, type Place } from './model'

export const mapBounds = [76, 160, 1324, 1045] as const

type Stop = { name: string; lon: number; lat: number; directions?: string }

function nearbyStations(place: Place): Stop[] {
  const metersLon = 111320 * Math.cos(place.lat * Math.PI / 180)
  const rows = stationIndex.stations.map((row) => {
    const [id, name, lon, lat] = row as [number, string, number, number]
    const meters = Math.hypot((lon - place.lon) * metersLon, (lat - place.lat) * 111320)
    return { id, name: name.endsWith('역') ? name : name + '역', lon, lat, meters }
  }).filter(row => row.meters <= 1000).sort((a, b) => a.meters - b.meters || a.id - b.id)
  const closest: Stop[] = []
  for (const row of rows) {
    if (!closest.some(s => s.name === row.name)) closest.push(row)
    if (closest.length === 2) break
  }
  return closest
}

export function transitItems(place: Place): Item[] {
  const venue = venues.find(v => v.site === place.id && v.address === place.address)
  const stops: Stop[] = venue?.transit.map(s => ({
    ...s, directions: s.line + ' · 도보 ' + s.minutes + '분',
  })) ?? nearbyStations(place)
  const axes = mapScale(place)
  const items: Item[] = []
  for (const [i, stop] of stops.entries()) {
    const x = axes.cx + (stop.lon - place.lon) * axes.x
    const y = axes.cy - (stop.lat - place.lat) * axes.y
    const [left, top, right, bottom] = mapBounds
    const inMap = x >= left && x <= right && y >= top && y <= bottom
    const key = String.fromCharCode(65 + i)
    const parts = [stop.name]
    if (inMap) {
      items.push({ ...baseItem('transit-stop-' + key), kind: 'dot', x, y, radius: 15 })
      parts[0] = key + '   ' + stop.name
    }
    if (stop.directions) parts.push(stop.directions)
    else {
      const meters = Math.hypot(x - axes.cx, y - axes.cy) * place.radius / 440
      parts.push('직선 약 ' + Math.round(meters / 10) * 10 + 'm')
    }
    if (!inMap) {
      const directions = ['동', '북동', '북', '북서', '서', '남서', '남', '남동']
      const octant = Math.round(Math.atan2(axes.cy - y, x - axes.cx) / (Math.PI / 4))
      parts.push('지도 밖 ' + directions[(8 + octant) % 8] + '쪽')
    }
    items.push(label('transit-guide-' + key, parts.join('  ·  '), 700, 1085 + i * 38, 26, {font:'sans'}))
  }
  return items
}

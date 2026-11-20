import institutions from '../data/evaluation/addresses.json'
import venues from './venues.json'
import { normalize, type Place, type Point, type Project } from './model'
import { canonicalAddress, parseRoadAddress } from './road-address'

export const registeredPlaces = [...institutions, ...venues]

// The map is centered on the source point, with north at the top.
export function mapScale(place: Place) {
  const y = 111320 * 440 / place.radius
  return { x: y * Math.cos(place.lat * Math.PI / 180), y, cx: 700, cy: 605 }
}

export function markerPoint(project: Project): Point | undefined {
  const place = project.geo?.place
  const marker = project.spec.items.find(i => i.id === 'destination')
  if (!place || marker?.kind !== 'flower' || marker.hidden) return
  const scale = mapScale(place)
  return [place.lon + (marker.x - scale.cx) / scale.x, place.lat - (marker.y - scale.cy) / scale.y]
}

function distanceMeters([lon, lat]: Point, [x, y]: Point) {
  return 111320 * Math.hypot((x - lon) * Math.cos((lat + y) * Math.PI / 360), y - lat)
}

export function localLocationCheck(project: Project) {
  if (!project.geo || project.imported) return
  const place = project.geo.place
  const record = registeredPlaces.find(r => r.site === place.id && r.address === project.address)
  const marker = markerPoint(project)
  const parts: string[] = []
  if (record) parts.push(record.name + '의 기관 안내 주소와 OSM 시설 ID 일치')
  // Check the road geometry actually visible in this drawing.
  let street = ''
  try { street = parseRoadAddress(project.address).street } catch { /* older free-form address */ }
  const roads = new Set(project.geo.roads.filter(r => r.name === street).map(r => String(r.id)))
  const onMap = project.spec.items.some(i =>
    i.kind === 'line' && !i.hidden && (i.id.startsWith('local-addr-') || roads.has(/^road-(\d+)-\d+(?:-center)?$/.exec(i.id)?.[1] ?? '')))
  if (street) parts.push(street + (onMap ? ' 도로 표시 확인' : ' 도로 표시 확인 필요'))
  if (marker) {
    const offset = distanceMeters(marker, [place.lon, place.lat])
    const source = place.entrance === 'commercial-address' ? '상가 주소' : 'OSM'
    parts.push(offset < 1 ? `목적지 표식이 ${source} 대표점과 일치` : `목적지 표식이 ${source} 대표점에서 ${Math.round(offset)}m 이동됨`)
  } else parts.push('목적지 표식 확인 필요')
  const official = venues.find(r => r.site === record?.site)
  if (official && marker) {
    const distance = distanceMeters(marker, [official.longitude, official.latitude])
    parts.push(`시설 홈페이지 게시 좌표와 약 ${Math.round(distance)}m 차이` + (distance > 50 ? ' (위치 확인 필요)' : ''))
  }
  return { message: parts.join(' · '), source: record?.url }
}

export function compareNaverAddress(address: string, result: string, point: Point, marker: Point) {
  function civic(value: string) {
    try {
      return canonicalAddress(parseRoadAddress(normalize(value)).address)
    } catch { return '' }
  }
  const a = civic(address), b = civic(result)
  const distance = distanceMeters(point, marker)
  const distanceNote = `네이버 주소 대표점과 목적지 표식 사이 약 ${Math.round(distance)}m`
  if (!a || !b || !(a === b || b.endsWith(' ' + a)))
    return '도로명주소 일치 여부 확인 필요 · ' + distanceNote
  return '도로명주소 일치 · ' + distanceNote +
    (distance <= 50 ? ' (50m 이내)' : ' (50m 초과 · 표식 위치 확인 필요)')
}

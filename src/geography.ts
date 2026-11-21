import { streetCenterline, type StreetPath } from './carriageways'
import type { LocalRoad } from './local-roads'
import type { Building } from './buildings'
import { mapBounds, stationsFor, transitItems } from './transit'
import { indexedAddresses } from './address-index'
import { registeredPlaces, mapScale } from './location-check'
import { parseRoadAddress, matchesRegion } from './road-address'
import {
  baseItem,
  coordinate,
  label,
  type Geography,
  type Item,
  type Place,
  type Point,
  type Road,
  type Spec,
} from './model'


interface Element {
  type: string
  id: number
  version: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
  nodes?: number[]
  geometry?: { lat: number; lon: number }[]
}
const endpoint = 'https://overpass-api.de/api/interpreter'
let retryAfter = 0
function waitForRetry(ms: number, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((done, fail) => {
    const stop = () => {
      clearTimeout(timer)
      fail(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop)
      done()
    }, ms)
    signal.addEventListener('abort', stop, { once: true })
  })
}
async function request(statement: string, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({
          data: '[out:json][timeout:20][maxsize:67108864];' + statement,
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        credentials: 'omit',
      })
      if (![502, 503, 504].includes(response.status) || attempt === 2) return response
      await response.body?.cancel()
    } catch (error) {
      if (signal.aborted) throw signal.reason
      if (error instanceof DOMException && error.name === 'TimeoutError')
        throw Error('Overpass 도로·주소 자료 조회 시간이 초과됐습니다.')
      if (attempt === 2) throw error
    }
    await waitForRetry(1500 * 2 ** attempt, signal)
  }
}
async function query(statement: string, signal: AbortSignal): Promise<Element[]> {
  if (Date.now() < retryAfter) throw Error('Overpass의 대기 시간이 끝난 후 다시 시도해 주세요.')
  const response = await request(statement, signal)
  if (!response.ok) {
    const retry = response.headers.get('Retry-After')
    if ([406, 429].includes(response.status)) {
      const delay =
        retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry ?? '') - Date.now()
      retryAfter = Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60000)
    }
    throw Error(`Overpass 응답 ${response.status}.${retry ? ' 다시 확인할 시간 ' + retry : ''}`)
  }
  const reader = response.body?.getReader()
  if (!reader) throw Error('지도 응답을 읽을 수 없습니다.')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.length
    if (total > 5 * 1024 * 1024) {
      await reader.cancel()
      throw Error('지도 응답이 5 MiB를 초과합니다. 조회 범위를 줄여 주세요.')
    }
    chunks.push(Uint8Array.from(value))
  }
  const json = JSON.parse(await new Blob(chunks).text())
  if (json.remark || !Array.isArray(json.elements) || json.elements.length > 20000)
    throw Error('Overpass가 불완전한 데이터를 반환했습니다.')
  return json.elements
}
export async function addresses(
  input: string,
  signal: AbortSignal,
  onlineIfMissing = true,
): Promise<(Place & { display: string })[]> {
  const { address, street, number } = parseRoadAddress(input)
  // The extract identifies possible objects. Their current address and position are checked
  // again by ID before a successful geographic refresh can be recorded.
  try {
    const candidates = await indexedAddresses(address, street, number, signal)
    if (candidates.length) return candidates
  } catch (error) {
    if (signal.aborted) throw error
  }
  if (!onlineIfMissing) return []
  const filter = `["addr:housenumber"="${number}"]["addr:street"="${street}"](33,124,39,132)`
  const rows = await query(`nwr${filter};out meta center 30;`, signal)
  return rows.flatMap((e) => {
    const c = e.center ?? e
    const area = [e.tags?.['addr:city'], e.tags?.['addr:district']].filter(Boolean).join(' ')
    if (!coordinate(c.lat!, c.lon!) || !Number.isSafeInteger(e.id) || !matchesRegion(address, area)) return []
    return [
      {
        address,
        venueName: e.tags?.['name:ko'] || e.tags?.name || '',
        display: [
          e.tags?.['name:ko'] || e.tags?.name,
          e.tags?.['addr:city'],
          e.tags?.['addr:district'],
          e.tags?.building || e.tags?.amenity,
        ]
          .filter(Boolean)
          .join(' · '),
        id: e.type + '/' + e.id,
        lat: c.lat!,
        lon: c.lon!,
        entrance: 'address',
        radius: 350,
      },
    ]
  })
}
export async function fetchGeography(place: Place, signal: AbortSignal, minimal = false): Promise<Geography> {
  const identifier = /^(node|way|relation)\/([1-9]\d{0,12})$/.exec(place.id)
  if (
    !identifier ||
    !coordinate(place.lat, place.lon) ||
    !Number.isFinite(place.radius) ||
    place.radius < 50 ||
    place.radius > 2000
  )
    throw Error('등록된 OSM 장소와 범위를 확인해 주세요.')
  const site = place.entrance === 'site-centroid'
  const target = await query(
    `${identifier[1]}(${identifier[2]});out meta ${site ? 'geom' : 'center'};`,
    signal,
  )
  const addressObject = target.find(
    (e) => e.type === identifier[1] && e.id === Number(identifier[2]),
  )
  if (!addressObject) throw Error('기존 목적지 객체를 다시 확인할 수 없습니다.')
  if (site) {
    const known = registeredPlaces.find((r) => r.site === place.id && r.address === place.address)
    if (!known || addressObject.tags?.name !== known.name)
      throw Error('단지의 현재 명칭과 주소 근거를 다시 확인해 주세요.')
    const ring = addressObject.geometry
    if (
      !ring ||
      ring.length < 4 ||
      addressObject.nodes?.[0] !== addressObject.nodes?.at(-1) ||
      ring.some((p) => !coordinate(p.lat, p.lon))
    )
      throw Error('단지 경계를 다시 확인할 수 없습니다.')
    const [o] = ring
    let twiceArea = 0,
      x = 0,
      y = 0
    for (let i = 1; i < ring.length; i++) {
      const ax = ring[i - 1].lon - o.lon,
        ay = ring[i - 1].lat - o.lat,
        bx = ring[i].lon - o.lon,
        by = ring[i].lat - o.lat,
        weight = ax * by - bx * ay
      twiceArea += weight
      x += (ax + bx) * weight
      y += (ay + by) * weight
    }
    if (!twiceArea) throw Error('단지 경계의 면적을 확인할 수 없습니다.')
    place = {
      ...place,
      lon: +(o.lon + x / (3 * twiceArea)).toFixed(7),
      lat: +(o.lat + y / (3 * twiceArea)).toFixed(7),
    }
  } else if (place.entrance === 'site-bbox-center') {
    const record = registeredPlaces.find((r) => r.site === place.id && r.address === place.address)
    const point = addressObject.center ?? addressObject
    if (!record || !coordinate(point.lat!, point.lon!))
      throw Error('기준 시설의 주소와 영역을 다시 확인해 주세요.')
    place = { ...place, lat: point.lat!, lon: point.lon! }
  } else {
    const point = addressObject.center ?? addressObject,
      t = addressObject.tags
    if (
      !coordinate(point.lat!, point.lon!) ||
      !t?.['addr:street'] ||
      !t['addr:housenumber'] ||
      !place.address.endsWith(t['addr:street'] + ' ' + t['addr:housenumber'])
    )
      throw Error('주소와 목적지 객체가 달라졌습니다. 주소를 다시 검색해 주세요.')
    place = { ...place, lat: point.lat!, lon: point.lon! }
  }
  const around = `(around:${Math.ceil(place.radius * 1.76)},${place.lat},${place.lon})`
  const rows = await query(
    minimal ? `(way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]${around};node["name"]["highway"="traffic_signals"]${around};);out meta geom;` :
    `(way["highway"~"^(motorway|primary|secondary|tertiary|trunk|residential|unclassified|service|living_street|road|primary_link|secondary_link|tertiary_link|trunk_link)$"]${around};nwr["name"]["amenity"~"^(school|library|community_centre)$"]${around};node["name"]["highway"="bus_stop"]${around};node["name"]["railway"="station"]${around};);out meta geom;`,
    signal,
  )
  const roads: Road[] = [],
    landmarks: Geography['landmarks'] = []
  for (const e of rows) {
    if (!Number.isSafeInteger(e.id) || !Number.isSafeInteger(e.version))
      throw Error('지도 객체의 버전을 확인할 수 없습니다.')
    const t = e.tags ?? {},
      name = (t['name:ko'] || t.name || '').slice(0, 120)
    if (e.type === 'way' && t.highway) {
      if (
        !e.nodes ||
        !e.geometry ||
        e.nodes.length !== e.geometry.length ||
        e.nodes.length < 2 ||
        e.nodes.some((n) => !Number.isSafeInteger(n)) ||
        e.geometry.some((p) => !p || !coordinate(p.lat, p.lon))
      )
        throw Error('일부 도로의 좌표 또는 연결점이 누락되었습니다.')
      roads.push({
        id: e.id,
        version: e.version,
        name,
        highway: t.highway,
        level: [t.layer, t.bridge, t.tunnel].map((s) => s ?? '').join('/'),
        ...(['yes', 'true', '1'].includes(t.oneway) ? {oneWay: true} : {}),
        nodes: e.nodes,
        points: e.geometry.map((p) => [p.lon, p.lat]),
      })
    } else if (name) {
      const points = e.geometry?.filter((p) => p && coordinate(p.lat, p.lon))
      const center =
        e.center ??
        (points?.length
          ? {
              lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
              lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
            }
          : e)
      if (coordinate(center.lat!, center.lon!))
        landmarks.push({
          id: e.type + '/' + e.id,
          version: e.version,
          name,
          ...(t.highway === 'traffic_signals' ? {kind:'junction' as const} : {}),
          point: [center.lon!, center.lat!],
        })
    }
  }
  if (!roads.length)
    throw Error('이 범위에서 도로 자료를 찾지 못했습니다. 기존 작업을 계속 편집할 수 있습니다.')
  roads.sort((a, b) => a.id - b.id)
  landmarks.sort((a, b) => a.id.localeCompare(b.id))
  return { source: 'osm', place, roads, landmarks }
}
type Rect = [number, number, number, number]
const box: Rect = [...mapBounds]
const inside = (p: Point) => p[0] >= box[0] && p[1] >= box[1] && p[0] <= box[2] && p[1] <= box[3]
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
function distanceToLine(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
    )
  return distance(p, [a[0] + t * dx, a[1] + t * dy])
}
// Iterative Douglas-Peucker, splitting at every shared OSM node first.
export function simplify(
  points: Point[],
  nodes: number[],
  junctions: Set<number>,
  tolerance: number,
) {
  const keep = new Set([0, points.length - 1])
  nodes.forEach((id, i) => {
    if (junctions.has(id)) keep.add(i)
  })
  const stops = [...keep].sort((a, b) => a - b),
    stack = stops.slice(1).map((b, i) => [stops[i], b])
  while (stack.length) {
    const [a, b] = stack.pop()!
    let far = -1,
      max = tolerance
    for (let i = a + 1; i < b; i++) {
      const d = distanceToLine(points[i], points[a], points[b])
      if (d > max) {
        max = d
        far = i
      }
    }
    if (far >= 0) {
      keep.add(far)
      stack.push([a, far], [far, b])
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i])
}
/** Clip a segment to a rectangle, including crossings with both endpoints outside. */
function clip(a: Point, b: Point, bounds: Rect = box): Point[] {
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  let lo = 0,
    hi = 1
  for (const [p, q] of [
    [-dx, a[0] - bounds[0]],
    [dx, bounds[2] - a[0]],
    [-dy, a[1] - bounds[1]],
    [dy, bounds[3] - a[1]],
  ]) {
    if (p === 0 && q < 0) return []
    if (p < 0) lo = Math.max(lo, q / p)
    if (p > 0) hi = Math.min(hi, q / p)
  }
  if (lo > hi) return []
  return [lo, hi].map((t) => [+(a[0] + t * dx).toFixed(2), +(a[1] + t * dy).toFixed(2)])
}

type Segment = { a: Point; b: Point; length: number; bounds: Rect }
type Placement = { x: number; y: number; angle: number; bounds: Rect }
const overlap = (a: Rect, b: Rect) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
function envelope(points: Point[]): Rect {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
function textWidth(text: string, size: number) {
  return (
    Array.from(text).reduce(
      (sum, c) => sum + (/^\s$/u.test(c) ? 0.36 : /[a-z0-9]/i.test(c) ? 0.68 : 1),
      0,
    ) * size
  )
}

function textFrame(text: string, size: number, x: number, y: number, angle: number) {
  const radians = (angle * Math.PI) / 180,
    cos = Math.cos(radians),
    sin = Math.sin(radians)
  const half = textWidth(text, size) / 2 + 6
  const local: Rect = [-half, -size - 5, half, size * 0.23 + 5]
  const corners: Point[] = [
    [local[0], local[1]],
    [local[2], local[1]],
    [local[2], local[3]],
    [local[0], local[3]],
  ]
  const bounds = envelope(corners.map(([u, v]) => [x + u * cos - v * sin, y + u * sin + v * cos]))
  return { local, bounds, cos, sin }
}

/** Bound the painted glyphs in their own coordinate system. Only nearby roads need an exact test. */
function placement(
  text: string,
  size: number,
  x: number,
  y: number,
  angle: number,
  segments: Segment[],
  occupied: Rect[],
): Placement | undefined {
  const { local, bounds, cos, sin } = textFrame(text, size, x, y, angle)
  if (
    !inside([bounds[0], bounds[1]]) ||
    !inside([bounds[2], bounds[3]]) ||
    occupied.some((rect) => overlap(rect, bounds))
  )
    return
  const unrotate = ([px, py]: Point): Point => [
    (px - x) * cos + (py - y) * sin,
    -(px - x) * sin + (py - y) * cos,
  ]
  if (
    segments.some(
      (seg) =>
        overlap(seg.bounds, bounds) && clip(unrotate(seg.a), unrotate(seg.b), local).length > 0,
    )
  )
    return
  return { x, y, angle, bounds }
}

function obstacles(items: Item[]) {
  const occupied: Rect[] = []
  const segments: Segment[] = []
  for (const item of items) {
    if (item.hidden || item.footer) continue
    if (item.kind === 'text') {
      occupied.push(textFrame(item.text, item.size, item.x, item.y, item.angle).bounds)
    } else if (item.kind === 'line') {
      for (let i = 1; i < item.points.length; i++) {
        const a = item.points[i - 1], b = item.points[i]
        segments.push({ a, b, length: distance(a, b), bounds: envelope([a, b]) })
      }
    } else {
      const pad = item.radius + 6
      const top = item.id === 'destination' ? item.radius * 2.1 + 5 : pad
      occupied.push([item.x - pad, item.y - top, item.x + pad, item.y + pad])
    }
  }

  return { occupied, segments }
}

// Place the exit name on the map when space permits. The guide below the map
// always includes the full name, including at crowded junctions.
export function exitLabels(items: Item[], place: Place, streets: Segment[] = [], stacked = false): Item[] {
  const { occupied, segments } = obstacles(items)
  const result: Item[] = []
  for (const [index, stop] of stationsFor(place).entries()) {
    const key = String.fromCharCode(65 + index)
    const marker = items.find(i => i.id === 'transit-stop-' + key)
    if (marker?.kind !== 'dot' || marker.hidden) continue
    const numbered = stacked && /^(.+역) (.+번 출구)$/.exec(stop.name)
    if (numbered) {
      const station = numbered[1], exit = numbered[2]
      const width = Math.max(textWidth(station, 28), textWidth(exit, 23))
      const side = width/2 + marker.radius + 18
      let placed = false
      for (const [dx,dy] of [[-side,-6],[side,-6],[0,48],[0,-52],[-side,-36],[side,-36],[-side,26],[side,26]]) {
        const x = marker.x+dx, y = marker.y+dy
        const upper = placement(station,28,x,y,0,streets,occupied)
        const lower = placement(exit,23,x,y+31,0,streets,occupied)
        if (!upper || !lower) continue
        result.push(label('transit-exit-'+key,station,x,y,28,{weight:700}),
          label('transit-number-'+key,exit,x,y+31,23,{font:'sans'}))
        occupied.push(upper.bounds,lower.bounds)
        placed = true
        break
      }
      if (placed) continue
    }
    const size = 25, half = textWidth(stop.name, size) / 2
    const offsets = [[-half-23, 8], [half+23, 8], [0, -24], [0, 53],
      [-half/2, 53], [half/2, 53], [-half/2, -24], [half/2, -24],
      [-half-18, -20], [half+18, -20], [-half-26, -44], [half+26, -44],
      [-half-18, 45], [half+18, 45],
      [-half, -42], [half, -42], [-half, 70], [half, 70]]
    // Prefer intact streets. In a dense block the caption takes priority and the
    // renderer leaves a small gap only under the chosen text.
    for (const lines of streets.length ? [streets, segments] : [segments]) {
      let chosen: Placement | undefined
      for (const [dx, dy] of offsets) {
        chosen = placement(stop.name, size, marker.x + dx, marker.y + dy, 0, lines, occupied)
        if (chosen) break
      }
      if (chosen) {
        result.push(label('transit-exit-' + key, stop.name, chosen.x, chosen.y, size, { weight: 700 }))
        occupied.push(chosen.bounds)
        break
      }
    }
  }
  return result
}

/** Add building names around the actual drawing, including user-positioned text and symbols. */
export function buildingItems(spec: Spec, place: Place, venue: string, buildings: Building[]): Item[] {
  const { occupied, segments } = obstacles(spec.items.filter(i => !i.id.startsWith('building-')))
  const axes = mapScale(place)
  const normalizeName = (name: string) => name.replace(/\s+/g, '').toLowerCase()
  const venueName = normalizeName(venue)
  const candidates = buildings.map(([id, rawName, lon, lat, rank, kind]) => {
    const point: Point = [axes.cx + (lon - place.lon) * axes.x, axes.cy - (lat - place.lat) * axes.y]
    const meters = distance(point, [axes.cx, axes.cy]) * place.radius / 440
    const name = kind === 'stop' ? rawName.replace(/[.]/g,'·') + ' 정류장' : rawName
    return { id, name, kind, meters, point, key: normalizeName(name), score: meters + rank * 40 }
  }).sort((a, b) => Number(b.kind === 'stop') - Number(a.kind === 'stop') ||
    (a.kind === 'stop' && b.kind === 'stop' ? a.meters - b.meters : a.score - b.score) || a.id.localeCompare(b.id))
  const result: Item[] = []
  const names = new Set<string>()
  const marked: Point[] = []
  const size = 24
  const extras = new Set<string>()
  const busReach = Math.min(400, Math.max(145, place.radius))
  let shownStop: string | undefined
  for (const { id, name, point, key, kind, meters } of candidates) {
    if (kind === 'storefront' && (marked.length >= 4 || meters > 70)) continue
    if (kind) {
      const reach = kind === 'stop' ? busReach : kind === 'shop' ? 110 : 145
      if (spec.style !== 'neighborhood' || (kind !== 'storefront' && extras.has(kind)) || meters > reach) continue
    }
    if (id === place.id || names.has(key) || key === venueName ||
        (venueName.length >= 4 && key.includes(venueName))) continue
    const [x, y] = point
    const bus = kind === 'stop'
    const radius = bus ? 17 : 5
    const pad = radius + 2
    const mark: Rect = [x-pad,y-pad,x+pad,y+pad]
    if (!inside([mark[0], mark[1]]) || !inside([mark[2], mark[3]]) ||
        occupied.some(rect => overlap(rect, mark)) || marked.some(p => distance(point, p) < 95) ||
        (!bus && segments.some(seg => overlap(seg.bounds, mark) && clip(seg.a, seg.b, mark).length))) continue
    const beside = textWidth(name, size) / 2 + radius + 12
    const shift = textWidth(name, size) / 3
    let captionPlaced = false
    for (const [dx, dy] of [[beside, 9], [-beside, 9], [0, -15], [0, 39],
      [-shift, -15], [shift, -15], [-shift, 39], [shift, 39],
      [beside,-12],[-beside,-12],[beside,30],[-beside,30],[0,-32],[0,52],
      [-shift,-32],[shift,-32],[-shift,52],[shift,52]]) {
      const position = placement(name, size, x + dx, y + dy, 0, segments, [...occupied, mark])
      if (!position) continue
      result.push(
        { ...baseItem((bus ? 'building-bus-mark-' : 'building-mark-') + id), kind: 'dot', x, y, radius },
        { ...label('building-name-' + id, name, position.x, position.y, size, { font: 'sans' }), tone: 'soft' },
      )
      captionPlaced = true
      names.add(key)
      if (kind) extras.add(kind)
      if (bus) shownStop = id
      marked.push(point)
      occupied.push(mark, position.bounds)
      break
    }
    if (bus && !captionPlaced) {
      // The stop can sit directly on a road, or have no space for an adjacent caption.
      result.push({...baseItem('building-bus-mark-' + id), kind:'dot', x, y, radius})
      extras.add('stop')
      shownStop = id
      marked.push(point)
      occupied.push(mark)
    }
    if (marked.length === (spec.style === 'neighborhood' ? 6 : 4)) break
  }
  if (spec.style === 'neighborhood' && !spec.items.some(i => i.id === 'transit-guide-B' || i.id === 'building-bus-guide')) {
    const nearest = candidates.filter(p => p.kind === 'stop' && p.meters <= 180)
      .sort((a,b) => Number(b.id === shownStop) - Number(a.id === shownStop) || a.meters - b.meters)[0]
    if (nearest) result.push(label('building-bus-guide',
      nearest.name + '  ·  목적지까지 직선 약 ' + Math.round(nearest.meters/10)*10 + 'm' + (inside(nearest.point) ? '' : '  ·  지도 밖'),
      700, spec.items.some(i => i.id === 'transit-guide-A') ? 1123 : 1085, 24, {font:'sans'}))
  }
  return result
}

// Trim only the ink under an existing caption or marker, preserving hand-edited placement.
function clearSegments(a: Point, b: Point, occupied: Rect[]): Point[][] {
  const visible = clip(a, b)
  if (!visible.length) return []
  const [start, end] = visible, length = distance(start, end)
  if (length < .1) return []
  const bounds = envelope(visible)
  const gaps = occupied.filter(rect => overlap(bounds, rect)).map(rect => clip(start, end, rect))
    .filter(pair => pair.length).map(([from,to]) => [distance(start,from)/length, distance(start,to)/length])
    .sort((u,v) => u[0]-v[0])
  const at = (t: number): Point => [start[0] + (end[0]-start[0])*t, start[1] + (end[1]-start[1])*t]
  const parts: Point[][] = []
  let cursor = 0
  for (const [lo, hi] of gaps) {
    if (lo > cursor + .001) parts.push([at(cursor), at(lo)])
    cursor = Math.max(cursor, hi)
  }
  if (cursor < .999) parts.push([at(cursor), end])
  return parts
}

export function selectLocalRoads(spec: Spec, place: Place, roads: LocalRoad[], street: string,
  reference?: Point): LocalRoad[] {
  const scale = 440 / place.radius
  const axes = mapScale(place)
  const anchors: Point[] = reference
    ? [[axes.cx + (reference[0] - place.lon) * axes.x, axes.cy - (reference[1] - place.lat) * axes.y]]
    : [[axes.cx, axes.cy]]
  if (!inside(anchors[0])) return []
  if (!reference) {
    const stop = spec.items.find(i => i.id === 'transit-stop-A' && i.kind === 'dot' && !i.hidden)
    if (stop?.kind === 'dot') anchors.push([stop.x, stop.y])
  }
  const selected = new Map<number, LocalRoad>()
  for (const anchor of anchors) {
    const ranked = roads.map(road => {
      let nearest = Infinity
      for (let i = 1; i < road.points.length; i++) nearest = Math.min(nearest,
        distanceToLine(anchor, road.points[i - 1], road.points[i]))
      return {road, meters: nearest / scale}
    }).sort((a,b) => a.meters - b.meters || a.road.id - b.road.id)
    const take = (entries: typeof ranked, limit: number) => {
      for (const {road} of entries.slice(0, limit)) selected.set(road.id, road)
    }
    take(ranked.filter(r => r.road.name === street && street && r.meters <= place.radius * 1.74), 3)
    take(ranked.filter(r => !r.road.foot && r.meters <= 95), 1)
    take(ranked.filter(r => r.road.foot && r.meters <= 65), 1)
  }
  if (spec.style === 'neighborhood' && !reference && place.radius < 300) {
    const names = new Map<string, {road: LocalRoad; meters: number}[]>()
    for (const road of roads) {
      if (road.foot || !road.name) continue
      let meters = Infinity
      for (let i=1; i<road.points.length; i++) for (const anchor of anchors)
        meters = Math.min(meters, distanceToLine(anchor, road.points[i-1], road.points[i]) / scale)
      if (meters > 115) continue
      const list = names.get(road.name) ?? []
      list.push({road, meters})
      names.set(road.name, list)
    }
    const streets = [...names.values()].map(list => list.sort((a,b) => a.meters-b.meters))
      .sort((a,b) => a[0].meters-b[0].meters)
    for (const group of streets.slice(0,3)) for (const {road} of group.slice(0,3))
      selected.set(road.id, road)
  }
  return [...selected.values()]
}

export function localRoadItems(spec: Spec, place: Place, roads: LocalRoad[], street: string, major: Road[] = []): Item[] {
  const scale = 440 / place.radius
  const drawn = new Set(spec.items.map(i =>
    /^(?:road-|local-(?:addr-)?(?:foot|lane)-)(\d+)-/.exec(i.id)?.[1]))
  const { occupied, segments } = obstacles(spec.items)
  const additions: Item[] = []
  const named = new Map<string, Segment[]>()
  // Snap a side street to a schematic centreline only at an actual shared OSM node.
  const axes = mapScale(place)
  const centerItems = spec.items.filter(i => i.kind === 'line' && i.id.endsWith('-center'))
  const centerAt = new Map<string, Segment[]>()
  for (const item of centerItems) {
    if (item.kind !== 'line') continue
    const source = major.find(r => r.id === Number(item.id.split('-')[1]))
    if (!source) continue
    const pieces = obstacles([item]).segments
    for (const road of major) if (road.oneWay && road.name === source.name && road.level === source.level) {
      for (const [x,y] of road.points) {
        const key = Math.round(x*1e6) + ',' + Math.round(y*1e6)
        centerAt.set(key, (centerAt.get(key) ?? []).concat(pieces))
      }
    }
  }
  function attach(p: Point): Point {
    const lon = place.lon + (p[0]-axes.cx)/axes.x, lat = place.lat - (p[1]-axes.cy)/axes.y
    const pieces = centerAt.get(Math.round(lon*1e6) + ',' + Math.round(lat*1e6))
    let best = p, limit = 25*scale
    for (const seg of pieces ?? []) {
      const dx = seg.b[0]-seg.a[0], dy = seg.b[1]-seg.a[1]
      const t = Math.max(0, Math.min(1, ((p[0]-seg.a[0])*dx + (p[1]-seg.a[1])*dy) / (dx*dx+dy*dy || 1)))
      const q: Point = [seg.a[0]+t*dx,seg.a[1]+t*dy]
      if (distance(p,q)<limit) { best=q; limit=distance(p,q) }
    }
    return best
  }
  for (const road of roads) {
    if (drawn.has(String(road.id))) continue
    const addr = street !== '' && road.name === street
    const key = 'local-' + (addr ? 'addr-' : '') + (road.foot ? 'foot-' : 'lane-') + road.id + '-'
    const points = simplify(centerAt.size ? road.points.map(attach) : road.points, [], new Set(), 2 * scale)
    let run: Point[] = [], section = 0
    for (let i = 1; i < points.length; i++) {
      for (const [a,b] of clearSegments(points[i-1], points[i], occupied)) {
        if (!run.length || distance(run[run.length-1], a) > .03) {
          run = [a]
          additions.push({ ...baseItem(key + section++, 'line'), kind: 'line',
            width: addr ? 2.7 : road.foot ? 1.8 : 2.2, points: run })
        }
        run.push(b)
        const segment = { a, b, length: distance(a,b), bounds: envelope([a,b]) }
        segments.push(segment)
        if (addr || (spec.style === 'neighborhood' && road.name)) {
          const list = named.get(road.name) ?? []
          list.push(segment)
          named.set(road.name, list)
        }
      }
    }
  }
  let labelCount = spec.items.filter(i => i.id.startsWith('local-street-name')).length
  const streetNames = [...named.keys()].sort((a,b) => Number(b === street) - Number(a === street))
  for (const name of streetNames) {
    if (labelCount >= 3 || spec.items.some(i => i.kind === 'text' && i.text === name)) continue
    let chosen: Placement | undefined
    for (const seg of named.get(name)!.sort((a,b) => b.length-a.length)) {
      if (seg.length < 52) continue
      for (const f of [.5,.25,.75]) {
        const x=seg.a[0]+(seg.b[0]-seg.a[0])*f, y=seg.a[1]+(seg.b[1]-seg.a[1])*f
        const side = textWidth(name,22)/2 + 12
        for (const [dx,dy] of [[0,-12],[0,32],[-side,7],[side,7],[-side,-12],[side,32]]) {
          chosen=placement(name,22,x+dx,y+dy,0,segments,occupied)
          if (chosen) break
        }
        if (chosen) break
      }
      if (chosen) break
    }
    if (chosen) {
      const id = name === street ? 'local-street-name' : 'local-street-name-' + name
      additions.push(label(id, name, chosen.x, chosen.y, 22, {font:'sans'}))
      occupied.push(chosen.bounds)
      labelCount++
    }
  }
  return additions
}

const majorRoads = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary'])

export function layout(geo: Geography, name: string, nearby: LocalRoad[] = []): Spec {
  const { place } = geo,
    scale = 440 / place.radius
  const axes = mapScale(place)
  const project = ([lon, lat]: Point): Point => [
    (lon - place.lon) * axes.x + axes.cx,
    axes.cy - (lat - place.lat) * axes.y,
  ]
  const items: Item[] = [label('title', '오시는 길', 700, 95, 30, { spacing: 4 })]
  const roads = geo.roads.filter(road => majorRoads.has(road.highway))
  // A shared node with three distinct branches is a junction. A bend, way split,
  // or crossing on another level is not. Preserve these nodes during simplification.
  const network = new Map<string, { id: number; point: Point; neighbors: Set<number>; mainStreets: Set<string> }>()
  for (const road of roads) {
    road.nodes.forEach((id, i) => {
      const key = road.level + ':' + id
      let node = network.get(key)
      if (!node) {
        node = { id, point: project(road.points[i]), neighbors: new Set(), mainStreets: new Set() }
        network.set(key, node)
      }
      if (road.name && road.highway !== 'tertiary') node.mainStreets.add(road.name)
      if (i > 0) node.neighbors.add(road.nodes[i - 1])
      if (i + 1 < road.nodes.length) node.neighbors.add(road.nodes[i + 1])
    })
  }
  const crossings = [...network.values()].filter(n => n.neighbors.size >= 3)
  const junctions = new Set(crossings.map(n => n.id))
  const segments: Segment[] = []
  const streets = new Map<string, { id: number; parts: Segment[] }>()
  const transit = transitItems(place, true, true)
  const destination: Item = { ...baseItem('destination'), kind: 'flower', x: 700, y: 605, radius: 28 }
  // Reserve station captions before drawing the street network or placing other names.
  const streetsForLabels: Segment[] = []
  const groups = new Map<string, StreetPath[]>()
  for (const road of roads) {
    const path = { road, points: simplify(road.points.map(project), road.nodes, junctions, (place.radius < 300 ? 4 : 10) * scale) }
    const key = road.name ? JSON.stringify([road.name, road.level]) : String(road.id)
    const group = groups.get(key) ?? []
    group.push(path)
    groups.set(key, group)
  }
  const simplified: StreetPath[] = []
  const pad = 50 * scale
  const extended: Rect = [box[0]-pad, box[1]-pad, box[2]+pad, box[3]+pad]
  for (const paths of groups.values()) {
    let center
    const divided = paths.filter(p => p.road.oneWay && p.road.name)
    const undivided = paths.filter(p => !p.road.oneWay || !p.road.name)
    // Older saved close-ups use a single schematic axis. At invitation scale keep both mapped carriageways.
    if (place.radius < 300 && divided.length > 1) {
      const edges = divided.flatMap(({points}) => points.slice(1).flatMap((p,i) => {
        const [a,b] = clip(points[i], p, extended)
        return a && distance(a,b) > .1 ? [{a,b,length:distance(a,b)}] : []
      }))
      center = streetCenterline(edges, scale)
    }
    if (center) {
      const endNodes = new Set(divided.flatMap(p => [p.road.nodes[0],p.road.nodes.at(-1)!]))
      for (const {road} of undivided) for (const i of [0,road.nodes.length-1]) {
        if (!endNodes.has(road.nodes[i])) continue
        const point = project(road.points[i])
        for (const j of [0,center.length-1])
          if (distance(point,center[j]) < 45*scale) center[j] = point
      }
      simplified.push({road: divided[0].road, points: simplify(center, [], new Set(), 3 * scale), center:true}, ...undivided)
    } else simplified.push(...paths)
  }
  for (const {points} of simplified) for (let i=1; i<points.length; i++) {
    const a = points[i-1], b = points[i]
    if (clip(a,b).length) streetsForLabels.push({a,b,length:distance(a,b),bounds:envelope([a,b])})
  }
  let addressStreet = ''
  if (nearby.length) {
    try { addressStreet = parseRoadAddress(place.address).street } catch { /* Legacy free-form address. */ }
  }
  const spec: Spec = {layout:'minimal', style:'neighborhood', ink:'#282626', items}
  const access = selectLocalRoads({...spec, items:transit}, place, nearby, addressStreet)
  for (const road of access) for (let i=1; i<road.points.length; i++) {
    const [a,b] = clip(road.points[i-1], road.points[i])
    if (a) segments.push({a,b,length:distance(a,b),bounds:envelope([a,b])})
  }
  const exits = exitLabels([destination, ...transit], place, [...streetsForLabels,...segments], true)
  const captions = obstacles(exits).occupied
  for (const { road, points, center } of simplified) {
    let run: Point[] = [],
      section = 0
    function flush() {
      if (run.length > 1) {
        const width = ['motorway', 'trunk', 'primary'].includes(road.highway) ? 5 : 3
        items.push({
          ...baseItem('road-' + road.id + '-' + section++ + (center ? '-center' : ''), 'soft'),
          kind: 'line',
          width,
          points: run,
        })
      }
      run = []
    }
    for (let i = 1; i < points.length; i++) {
      const visible = clearSegments(points[i - 1], points[i], captions)
      if (!visible.length) flush()
      for (const [a, b] of visible) {
        if (!run.length || distance(run.at(-1)!, a) > 0.03) {
          flush()
          run = [a]
        }
        run.push(b)
        const seg = { a, b, length: distance(a, b), bounds: envelope([a, b]) }
        segments.push(seg)
        if (road.name) {
          const street = streets.get(road.name) ?? { id: road.id, parts: [] }
          street.parts.push(seg)
          streets.set(road.name, street)
        }
      }
    }
    flush()
  }

  const occupied: Rect[] = [...captions, [673, 541, 727, 614]]
  for (const stop of transit) {
    if (stop.kind === 'dot') occupied.push([stop.x - 19, stop.y - 19, stop.x + 19, stop.y + 19])
  }
  // Mark a divided intersection once at invitation scale.
  const marked: Point[] = []
  const namedNodes = new Map(geo.landmarks.filter(l => l.kind === 'junction').map(l => [l.id, l.name]))
  const usedJunctionNames = new Set<string>()
  crossings.sort((a, b) => Number(namedNodes.has('node/' + b.id)) - Number(namedNodes.has('node/' + a.id)) || b.mainStreets.size - a.mainStreets.size ||
    distance(a.point, [700, 605]) - distance(b.point, [700, 605]) || a.id - b.id)
  for (const crossing of crossings) {
    const title = namedNodes.get('node/' + crossing.id)
    if (title && usedJunctionNames.has(title)) continue
    let at = crossing.point
    const [first, second] = [...crossing.mainStreets]
    // Locate the same physical junction on the two printed street axes.
    if (first && second) {
      let closest = 45 * scale
      for (const a of streets.get(first)?.parts ?? []) for (const b of streets.get(second)?.parts ?? []) {
        const dx=a.b[0]-a.a[0], dy=a.b[1]-a.a[1], ex=b.b[0]-b.a[0], ey=b.b[1]-b.a[1]
        const det=dx*ey-dy*ex
        if (Math.abs(det)<.001) continue
        const x=b.a[0]-a.a[0], y=b.a[1]-a.a[1], t=(x*ey-y*ex)/det, u=(x*dy-y*dx)/det
        if (t<-.001 || t>1.001 || u<-.001 || u>1.001) continue
        const point: Point=[a.a[0]+t*dx,a.a[1]+t*dy]
        const d=distance(point,crossing.point)
        if (d<closest) { closest=d; at=point }
      }
    }
    const [x, y] = at
    const bounds: Rect = [x - 8, y - 8, x + 8, y + 8]
    if (!inside([bounds[0], bounds[1]]) || !inside([bounds[2], bounds[3]]) ||
        occupied.some(rect => overlap(bounds, rect)) ||
        marked.some(p => distance(p, at) < 55)) continue
    items.push({ ...baseItem('junction-' + crossing.id), kind: 'dot', x, y, radius: 5 })
    occupied.push(bounds)
    marked.push(at)
    if (title) {
      usedJunctionNames.add(title)
      const caption = /(거리|교차로|로터리|분기점)$/.test(title) ? title : title + ' 교차로'
      const side = textWidth(caption, 25)/2 + 15
      for (const [dx,dy] of [[side,-12],[-side,-12],[side,32],[-side,32],[0,-25],[0,46],[-side,-35],[side,-35],[-side,65],[side,65],[-side,-65],[side,-65],[-side,95],[side,95]]) {
        const pos = placement(caption,25,x+dx,y+dy,0,segments,occupied)
        if (!pos) continue
        items.push(label('crossing-name-' + crossing.id,caption,pos.x,pos.y,25,{font:'sans'}))
        occupied.push(pos.bounds)
        break
      }
    }
    if (marked.length === 6) break
  }
  items.push(destination)
  // Keep the marker at its measured point while choosing a clear position for its name.
  let venueSize = Math.max(24, Math.min(40, Math.floor(990 / Math.max(1, textWidth(name, 1)))))
  const beside = textWidth(name, venueSize) / 2 + 38
  let venue: Placement | undefined
  for (const [dx, dy] of [
    [0, -72],
    [38 - beside, -70],
    [beside - 38, -70],
    [0, 64],
    [beside, 12],
    [-beside, 12],
    [beside, -20],
    [-beside, -20],
    [-34, -64],
    [34, -64],
    [0, -95],
    [0, 125],
    [-beside, 49],
    [beside, 49],
    [-beside, -52],
    [beside, -52],
    [-75, -60],
    [75, -60],
  ]) {
    venue = placement(name, venueSize, 700 + dx, 605 + dy, 0, segments, occupied)
    if (venue) break
  }
  if (!venue) {
    // Minor streets are drawn last and can leave space under the venue name.
    // Try a compact label beside the pin before resorting to the top margin.
    const mainSegments = obstacles(items.filter(i => i.id.startsWith('road-'))).segments
    for (const size of [venueSize, Math.max(24, venueSize - 7), 24]) {
      const side = textWidth(name,size)/2 + 42
      for (const [dx,dy] of [[0,61],[0,-77],[side,-16],[-side,-16],[side,32],[-side,32],
        [-45,77],[45,77],[-45,-85],[45,-85],[0,105]]) {
        venue = placement(name,size,700+dx,605+dy,0,mainSegments,occupied)
        if (venue) break
      }
      // Search the nearby blocks when none of the preferred offsets fits between arterials.
      for (let radius = 40; radius <= 150 && !venue; radius += 15) {
        for (let step = 0; step < 24 && !venue; step++) {
          const angle = step * Math.PI / 12
          venue = placement(name, size, 700 + radius * Math.cos(angle),
            605 + radius * Math.sin(angle), 0, mainSegments, occupied)
        }
      }
      if (venue) { venueSize = size; break }
    }
  }
  if (venue) {
    items.push(label('venue', name, venue.x, venue.y, venueSize, { weight: 700 }))
    occupied.push(venue.bounds)
  } else {
    // The blank strip above the map preserves the name in map-only output for dense sites.
    const headerSize = Math.max(
      18,
      Math.min(27, Math.floor(1040 / Math.max(1, textWidth(name, 1)))),
    )
    const lines: string[] = []
    let line = ''
    for (const char of name) {
      if (line && textWidth(line + char, headerSize) > 1040) {
        lines.push(line)
        line = ''
      }
      line += char
    }
    lines.push(line)
    lines.forEach((text, i) =>
      items.push(
        label(
          i ? 'venue-' + i : 'venue',
          text,
          700,
          lines.length === 1 ? 139 : 119 + i * 26,
          headerSize,
          { weight: 700 },
        ),
      ),
    )
  }

  items.push(...exits)

  // Print a street name beside its own longest visible segments, parallel and upright.
  // Prioritize the address street, then those with the most room for a legible label.
  const ranked = [...streets.entries()].map(([text, street]) => ({
    text,
    ...street,
    parts: street.parts.sort((a, b) => b.length - a.length),
  }))
  ranked.sort(
    (a, b) =>
      Number(place.address.includes(b.text)) - Number(place.address.includes(a.text)) ||
      b.parts[0].length - a.parts[0].length ||
      a.id - b.id,
  )
  let streetLabels = 0
  for (const street of ranked) {
    if (streetLabels === 5) break
    let chosen: Placement | undefined
    for (const seg of street.parts.slice(0, 10)) {
      if (seg.length < Math.min(60, textWidth(street.text, 25) * 0.38)) break
      let angle = (Math.atan2(seg.b[1] - seg.a[1], seg.b[0] - seg.a[0]) * 180) / Math.PI
      if (angle > 90) angle -= 180
      if (angle < -90) angle += 180
      const theta = (angle * Math.PI) / 180
      for (const fraction of [0.5, 0.32, 0.68]) {
        const x = seg.a[0] + (seg.b[0] - seg.a[0]) * fraction,
          y = seg.a[1] + (seg.b[1] - seg.a[1]) * fraction
        for (const offset of [-18, 38, -32, 52, -textWidth(street.text,25)/2-15, textWidth(street.text,25)/2+15]) {
          chosen = placement(
            street.text,
            25,
            x - Math.sin(theta) * offset,
            y + Math.cos(theta) * offset,
            angle,
            segments,
            occupied,
          )
          if (chosen) break
        }
        if (chosen) break
      }
      if (chosen) break
    }
    if (chosen) {
      occupied.push(chosen.bounds)
      streetLabels++
      items.push(
        label('street-' + street.id, street.text, chosen.x, chosen.y, 25, {
          font: 'sans',
          angle: chosen.angle,
        }),
      )
    }
  }

  items.push(
    ...transit,
    {
      ...baseItem('divider', 'line'),
      kind: 'line',
      width: 1.1,
      points: [
        [490, 1179],
        [910, 1179],
      ],
      footer: true,
    },
    { ...label('address', place.address, 700, 1250, 31), footer: true },
    { ...label('details', '', 700, 1320, 27), footer: true },
    { ...label('parking', '', 700, 1374, 25, { font: 'sans' }), footer: true },
  )
  items.unshift(...localRoadItems(spec, place, access, addressStreet, roads))
  return spec
}

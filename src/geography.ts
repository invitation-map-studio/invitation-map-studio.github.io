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
    minimal ? `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]${around};out meta geom;` :
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
      occupied.push([item.x - pad, item.y - pad, item.x + pad, item.y + pad])
    }
  }

  return { occupied, segments }
}

// Place the exit name on the map when space permits. The guide below the map
// always includes the full name, including at crowded junctions.
export function exitLabels(items: Item[], place: Place): Item[] {
  const { occupied, segments } = obstacles(items)
  const result: Item[] = []
  for (const [index, stop] of stationsFor(place).entries()) {
    if (!stop.name.endsWith('번 출구')) continue
    const key = String.fromCharCode(65 + index)
    const marker = items.find(i => i.id === 'transit-stop-' + key)
    if (marker?.kind !== 'dot' || marker.hidden) continue
    const size = 25, half = textWidth(stop.name, size) / 2
    for (const [dx, dy] of [[-half-23, 8], [half+23, 8], [0, -24], [0, 53],
      [-half/2, 53], [half/2, 53], [-half/2, -24], [half/2, -24],
      [-half-18, -20], [half+18, -20], [-half-26, -44], [half+26, -44],
      [-half-18, 45], [half+18, 45],
      [-half, -42], [half, -42], [-half, 70], [half, 70]]) {
      const pos = placement(stop.name, size, marker.x + dx, marker.y + dy, 0, segments, occupied)
      if (!pos) continue
      result.push(label('transit-exit-' + key, stop.name, pos.x, pos.y, size, { weight: 700 }))
      occupied.push(pos.bounds)
      break
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
  const candidates = buildings.map(([id, name, lon, lat, rank]) => {
    const point: Point = [axes.cx + (lon - place.lon) * axes.x, axes.cy - (lat - place.lat) * axes.y]
    const meters = distance(point, [axes.cx, axes.cy]) * place.radius / 440
    return { id, name, point, key: normalizeName(name), score: meters + rank * 90 }
  }).sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
  const result: Item[] = []
  const names = new Set<string>()
  const marked: Point[] = []
  const size = 24
  for (const { id, name, point, key } of candidates) {
    if (id === place.id || names.has(key) || key === venueName ||
        (venueName.length >= 4 && key.includes(venueName))) continue
    const [x, y] = point
    const mark: Rect = [x - 7, y - 7, x + 7, y + 7]
    if (!inside([mark[0], mark[1]]) || !inside([mark[2], mark[3]]) ||
        occupied.some(rect => overlap(rect, mark)) || marked.some(p => distance(point, p) < 95) ||
        segments.some(seg => overlap(seg.bounds, mark) && clip(seg.a, seg.b, mark).length)) continue
    const beside = textWidth(name, size) / 2 + 14
    const shift = textWidth(name, size) / 3
    for (const [dx, dy] of [[beside, 9], [-beside, 9], [0, -15], [0, 39],
      [-shift, -15], [shift, -15], [-shift, 39], [shift, 39]]) {
      const position = placement(name, size, x + dx, y + dy, 0, segments, [...occupied, mark])
      if (!position) continue
      result.push(
        { ...baseItem('building-mark-' + id, 'soft'), kind: 'dot', x, y, radius: 5 },
        { ...label('building-name-' + id, name, position.x, position.y, size, { font: 'sans' }), tone: 'soft' },
      )
      names.add(key)
      marked.push(point)
      occupied.push(mark, position.bounds)
      break
    }
    if (marked.length === 5) break
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
    take(ranked.filter(r => r.road.name === street && street && r.meters <= place.radius), 6)
    take(ranked.filter(r => !r.road.foot && r.meters <= 170), 5)
    take(ranked.filter(r => r.road.foot && r.meters <= 130), 5)
  }
  return [...selected.values()]
}

export function localRoadItems(spec: Spec, place: Place, roads: LocalRoad[], street: string): Item[] {
  const scale = 440 / place.radius
  const drawn = new Set(spec.items.map(i =>
    /^(?:road-|local-(?:addr-)?(?:foot|lane)-)(\d+)-/.exec(i.id)?.[1]))
  const { occupied, segments } = obstacles(spec.items)
  const additions: Item[] = []
  const named: Segment[] = []
  for (const road of roads) {
    if (drawn.has(String(road.id))) continue
    const addr = street !== '' && road.name === street
    const key = 'local-' + (addr ? 'addr-' : '') + (road.foot ? 'foot-' : 'lane-') + road.id + '-'
    const points = simplify(road.points, [], new Set(), 2 * scale)
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
        if (addr) named.push(segment)
      }
    }
  }
  if (named.length && !spec.items.some(i => i.kind === 'text' && (i.text === street || i.id === 'local-street-name'))) {
    for (const seg of named.sort((a,b) => b.length-a.length)) {
      let angle = Math.atan2(seg.b[1]-seg.a[1], seg.b[0]-seg.a[0]) * 180 / Math.PI
      if (angle > 90) angle -= 180
      if (angle < -90) angle += 180
      const rad = angle * Math.PI/180
      for (const fraction of [.5,.3,.7]) for (const offset of [-14,32,-29,45]) {
        const x = seg.a[0] + (seg.b[0]-seg.a[0])*fraction - Math.sin(rad)*offset
        const y = seg.a[1] + (seg.b[1]-seg.a[1])*fraction + Math.cos(rad)*offset
        if (placement(street, 22, x, y, angle, segments, occupied)) {
          additions.push(label('local-street-name', street, x, y, 22, {font:'sans', angle}))
          return additions
        }
      }
    }
  }
  return additions
}

const majorRoads = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary'])

export function layout(geo: Geography, name: string): Spec {
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
  for (const road of roads) {
    const points = simplify(road.points.map(project), road.nodes, junctions, 10 * scale)
    let run: Point[] = [],
      section = 0
    function flush() {
      if (run.length > 1) {
        const width = ['motorway', 'trunk', 'primary'].includes(road.highway) ? 5 : 3
        items.push({
          ...baseItem('road-' + road.id + '-' + section++, 'soft'),
          kind: 'line',
          width,
          points: run,
        })
      }
      run = []
    }
    for (let i = 1; i < points.length; i++) {
      const clipped = clip(points[i - 1], points[i])
      if (!clipped.length) {
        flush()
        continue
      }
      const [a, b] = clipped,
        length = distance(a, b)
      if (!length) continue
      if (!run.length || distance(run.at(-1)!, a) > 0.03) {
        flush()
        run = [a]
      }
      run.push(b)
      const seg = { a, b, length, bounds: envelope([a, b]) }
      segments.push(seg)
      if (road.name) {
        const street = streets.get(road.name) ?? { id: road.id, parts: [] }
        street.parts.push(seg)
        streets.set(road.name, street)
      }
    }
    flush()
  }

  const transit = transitItems(place)
  const occupied: Rect[] = [[664, 569, 736, 641]]
  for (const stop of transit) {
    if (stop.kind === 'dot') occupied.push([stop.x - 19, stop.y - 19, stop.x + 19, stop.y + 19])
  }
  // Mark a divided intersection once at invitation scale.
  const marked: Point[] = []
  crossings.sort((a, b) => b.mainStreets.size - a.mainStreets.size ||
    distance(a.point, [700, 605]) - distance(b.point, [700, 605]) || a.id - b.id)
  for (const crossing of crossings) {
    const [x, y] = crossing.point
    const bounds: Rect = [x - 8, y - 8, x + 8, y + 8]
    if (!inside([bounds[0], bounds[1]]) || !inside([bounds[2], bounds[3]]) ||
        occupied.some(rect => overlap(bounds, rect)) ||
        marked.some(p => distance(p, crossing.point) < 55)) continue
    items.push({ ...baseItem('junction-' + crossing.id), kind: 'dot', x, y, radius: 6 })
    occupied.push(bounds)
    marked.push(crossing.point)
    if (marked.length === 6) break
  }
  items.push({ ...baseItem('destination'), kind: 'flower', x: 700, y: 605, radius: 28 })
  // Keep the marker at its measured point while choosing a clear position for its name.
  const venueSize = Math.max(24, Math.min(40, Math.floor(990 / Math.max(1, textWidth(name, 1)))))
  const beside = textWidth(name, venueSize) / 2 + 38
  let venue: Placement | undefined
  for (const [dx, dy] of [
    [0, -53],
    [0, 91],
    [beside, 12],
    [-beside, 12],
    [beside, -20],
    [-beside, -20],
    [-34, -64],
    [34, -64],
    [0, -95],
    [0, 125],
    [-75, -60],
    [75, -60],
  ]) {
    venue = placement(name, venueSize, 700 + dx, 605 + dy, 0, segments, occupied)
    if (venue) break
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

  const exits = exitLabels([...items, ...transit], place)
  for (const item of exits) if (item.kind === 'text')
    occupied.push(textFrame(item.text, item.size, item.x, item.y, item.angle).bounds)
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
        for (const offset of [-14, 38, -25, 49]) {
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
  return { layout: 'minimal', ink: '#393334', items }
}

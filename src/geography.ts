import { indexedAddresses } from './address-index'
import registered from '../data/evaluation/addresses.json'
import {
  baseItem,
  coordinate,
  label,
  normalize,
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
        throw Error('지도 공급자 응답 시간이 초과됐습니다. 잠시 후 다시 확인해 주세요.')
      if (attempt === 2) throw error
    }
    await waitForRetry(1500 * 2 ** attempt, signal)
  }
}
async function query(statement: string, signal: AbortSignal): Promise<Element[]> {
  if (Date.now() < retryAfter) throw Error('지도 공급자의 대기 시간이 끝난 후 다시 시도해 주세요.')
  const response = await request(statement, signal)
  if (!response.ok) {
    const retry = response.headers.get('Retry-After')
    if ([406, 429].includes(response.status)) {
      const delay =
        retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry ?? '') - Date.now()
      retryAfter = Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60000)
    }
    throw Error(`지도 공급자 응답 ${response.status}.${retry ? ' 다시 확인할 시간 ' + retry : ''}`)
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
    throw Error('지도 공급자가 불완전한 데이터를 반환했습니다.')
  return json.elements
}
export async function addresses(
  input: string,
  signal: AbortSignal,
  onlineIfMissing = true,
): Promise<(Place & { display: string })[]> {
  const address = normalize(input),
    match = address.match(/(?:^|\s)([가-힣a-zA-Z0-9·.]+(?:길|로))\s+(\d{1,5}(?:-\d{1,5})?)$/)
  if (!match) throw Error('도로명과 건물번호까지 입력해 주세요. 예시: 다산중앙로82번안길 74')
  // The extract identifies possible objects. Their current address and position are checked
  // again by ID before a successful geographic refresh can be recorded.
  try {
    const candidates = await indexedAddresses(address, match[1], match[2], signal)
    if (candidates.length) return candidates
  } catch (error) {
    if (signal.aborted) throw error
  }
  if (!onlineIfMissing) return []
  const filter = `["addr:housenumber"="${match[2]}"]["addr:street"="${match[1]}"](33,124,39,132)`
  const rows = await query(`nwr${filter};out meta center 30;`, signal)
  return rows.flatMap((e) => {
    const c = e.center ?? e
    if (!coordinate(c.lat!, c.lon!) || !Number.isSafeInteger(e.id)) return []
    return [
      {
        address,
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
export async function fetchGeography(place: Place, signal: AbortSignal): Promise<Geography> {
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
    const known = registered.find((r) => r.site === place.id && r.address === place.address)
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
    const record = registered.find((r) => r.site === place.id && r.address === place.address)
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
    `(way["highway"~"^(primary|secondary|tertiary|trunk|residential|unclassified|service|living_street|road|primary_link|secondary_link|tertiary_link|trunk_link)$"]${around};nwr["name"]["amenity"~"^(school|library|community_centre)$"]${around};node["name"]["highway"="bus_stop"]${around};node["name"]["railway"="station"]${around};);out meta geom;`,
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
const box: Rect = [76, 160, 1324, 1045]
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

export function layout(geo: Geography, name: string): Spec {
  const { place } = geo,
    scale = 440 / place.radius
  const project = ([lon, lat]: Point): Point => [
    (lon - place.lon) * 111320 * Math.cos((place.lat * Math.PI) / 180) * scale + 700,
    605 - (lat - place.lat) * 111320 * scale,
  ]
  const items: Item[] = [
    label('title', '오시는 길', 700, 86, 30, { spacing: 4 }),
    label('north', 'N', 1268, 88, 22),
    {
      ...baseItem('north-line', 'soft'),
      kind: 'line',
      points: [
        [1268, 145],
        [1268, 107],
        [1263, 115],
      ],
      width: 2,
    },
  ]
  const seen = new Set<number>(),
    junctions = new Set<number>()
  for (const road of geo.roads)
    for (const node of road.nodes) {
      if (seen.has(node)) junctions.add(node)
      seen.add(node)
    }
  const segments: Segment[] = []
  const streets = new Map<string, { id: number; parts: Segment[] }>()
  for (const road of geo.roads) {
    const points = simplify(road.points.map(project), road.nodes, junctions, 2 * scale)
    let run: Point[] = [],
      section = 0
    function flush() {
      if (run.length > 1) {
        const width = ['service', 'living_street'].includes(road.highway) ? 1.3 : 2.8
        items.push({
          ...baseItem('road-' + road.id + '-' + section++),
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

  const occupied: Rect[] = [[664, 569, 736, 641]]
  items.push({ ...baseItem('destination'), kind: 'flower', x: 700, y: 605, radius: 28 })
  // Keep the marker at its measured point while choosing a clear position for its name.
  const venueSize = Math.max(24, Math.min(40, Math.floor(990 / Math.max(1, textWidth(name, 1)))))
  let venue: Placement | undefined
  for (const [dx, dy] of [
    [0, -53],
    [0, 91],
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
  for (const street of ranked.slice(0, 24)) {
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
      items.push(
        label('street-' + street.id, street.text, chosen.x, chosen.y, 25, {
          font: 'sans',
          angle: chosen.angle,
        }),
      )
    }
  }

  // Landmark dots remain at the source coordinate, even when the label moves to its side.
  const nearby = geo.landmarks
    .map((l) => ({ ...l, point: project(l.point) }))
    .filter((l) => inside(l.point))
  nearby.sort((a, b) => distance(a.point, [700, 605]) - distance(b.point, [700, 605]))
  const placedNames = new Set<string>()
  for (const lm of nearby.slice(0, 50)) {
    if (placedNames.size >= 9 || placedNames.has(lm.name)) continue
    const [x, y] = lm.point
    const dot: Rect = [x - 6, y - 6, x + 6, y + 6]
    if (occupied.some((b) => overlap(b, dot))) continue
    const half = textWidth(lm.name, 25) / 2 + 13
    let chosen: Placement | undefined
    for (const [dx, dy] of [
      [0, -16],
      [0, 40],
      [half, 9],
      [-half, 9],
      [half, -17],
      [-half, -17],
      [half, 38],
      [-half, 38],
    ]) {
      chosen = placement(lm.name, 25, x + dx, y + dy, 0, segments, [...occupied, dot])
      if (chosen) break
    }
    if (chosen) {
      occupied.push(chosen.bounds, dot)
      placedNames.add(lm.name)
      items.push(
        { ...baseItem('dot-' + lm.id), kind: 'dot', x, y, radius: 4.3 },
        label('label-' + lm.id, lm.name, chosen.x, chosen.y, 25),
      )
    }
  }
  items.push(
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
  return { ink: '#393334', items }
}

export type Tone = 'ink' | 'soft' | 'line'
export type Point = [number, number]
export type Label = {
  kind: 'text'
  text: string
  x: number
  y: number
  size: number
  font: 'serif' | 'sans'
  weight: 400 | 700
  anchor: 'middle' | 'start' | 'end'
  spacing: number
  angle: number
}
export type Item = { id: string; tone: Tone; footer: boolean; hidden: boolean } & (
  | Label
  | { kind: 'line'; points: Point[]; width: number }
  | { kind: 'dot' | 'flower'; x: number; y: number; radius: number }
)
export interface Spec {
  layout?: 'minimal'
  style?: 'vicinity' | 'neighborhood'
  items: Item[]
  ink: string
}
export interface Place {
  address: string
  id: string
  lat: number
  lon: number
  entrance: string
  radius: number
}
export interface Road {
  id: number
  version: number
  name: string
  highway: string
  level: string
  oneWay?: boolean
  nodes: number[]
  points: Point[]
}
export interface Landmark {
  kind?: 'junction'
  id: string
  version: number
  name: string
  point: Point
}
export interface Geography {
  source: 'osm'
  place: Place
  roads: Road[]
  landmarks: Landmark[]
}
export interface Review {
  evidence?: { url: string; method: string; checks: string[] }
  status: 'pending' | 'checked'
  verifiedAt: string | null
  note: string
}
export interface Project {
  schema: 1
  id: string
  name: string
  address: string
  origin: 'reference' | 'osm'
  spec: Spec
  geo: Geography | null
  lastSuccessfulFetchAt: string | null
  expiresAt: string | null
  lastAccessedAt: string
  imported: boolean
  refreshFailed?: boolean
  review: Review
}
export const pending = (): Review => ({ status: 'pending', verifiedAt: null, note: '' })
export const DAY = 86_400_000
export const coordinate = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
export const normalize = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ')
export function placeKey(p: Place) {
  return JSON.stringify([
    normalize(p.address),
    p.id,
    p.lon,
    p.lat,
    p.entrance,
    p.radius,
    'osm',
    'layout-1',
  ])
}
export function fresh(
  s: {
    lastSuccessfulFetchAt: string | null
    expiresAt: string | null
    lastAccessedAt: string
    imported: boolean
  },
  now: number,
) {
  const start = Date.parse(s.lastSuccessfulFetchAt ?? ''),
    end = Date.parse(s.expiresAt ?? ''),
    access = Date.parse(s.lastAccessedAt)
  return (
    !s.imported &&
    start <= access &&
    access <= now &&
    start <= now &&
    end === start + DAY &&
    now < end
  )
}
export async function digest(data: BufferSource | string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
export function iso(time = Date.now()) {
  return new Date(time).toISOString()
}
export const baseItem = (id: string, tone: Tone = 'ink') => ({
  id,
  tone,
  footer: false,
  hidden: false,
})
export function label(
  id: string,
  text: string,
  x: number,
  y: number,
  size: number,
  extra: Partial<Label> = {},
): Item {
  return {
    ...baseItem(id),
    kind: 'text',
    text,
    x,
    y,
    size,
    font: 'serif',
    weight: 400,
    anchor: 'middle',
    spacing: 0,
    angle: 0,
    ...extra,
  }
}

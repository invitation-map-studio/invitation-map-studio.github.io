// Create a print centreline only where two mapped one-way carriageways run
// alongside one another. The original roads and their junction IDs stay in Geography.
import type { Point, Road } from './model'

export type StreetPath = { road: Road; points: Point[]; center?: boolean }
type Edge = { a: Point; b: Point; length: number }

export function streetCenterline(edges: Edge[], scale: number): Point[] | undefined {
  if (!edges.length) return
  const longest = edges.reduce((a,b) => a.length >= b.length ? a : b)
  if (longest.length < 30 * scale) return
  const ux = (longest.b[0] - longest.a[0]) / longest.length
  const uy = (longest.b[1] - longest.a[1]) / longest.length
  const along = ([x,y]: Point) => x * ux + y * uy
  const across = ([x,y]: Point) => y * ux - x * uy
  const parts = []
  for (const edge of edges) {
    const start = along(edge.a), end = along(edge.b)
    if (Math.abs(end - start) < .82 * edge.length) {
      // Short turn segments belong to the junction; a long branch is ambiguous.
      if (edge.length > 45 * scale) return
      continue
    }
    parts.push({start, end, a: across(edge.a), b: across(edge.b)})
  }
  const low = Math.min(...parts.map(p => Math.min(p.start, p.end)))
  const high = Math.max(...parts.map(p => Math.max(p.start, p.end)))
  const count = Math.ceil((high - low) / (8 * scale))
  if (count < 6) return
  const samples: Point[] = []
  let paired = 0
  for (let i = 0; i < count; i++) {
    const t = low + (i + .5) * (high - low) / count
    const hits = parts.filter(p => (t - p.start) * (t - p.end) <= 0)
    if (!hits.length || hits.length > 2) return
    const offsets = hits.map(p => p.a + (p.b - p.a) * (t - p.start) / (p.end - p.start))
    if (hits.length === 2) {
      if ((hits[0].end - hits[0].start) * (hits[1].end - hits[1].start) >= 0 ||
          Math.abs(offsets[1] - offsets[0]) > 45 * scale) return
      if (Math.abs(offsets[1] - offsets[0]) > 3 * scale) paired++
    }
    const mid = offsets.reduce((a,b) => a+b, 0) / offsets.length
    samples.push([t * ux - mid * uy, t * uy + mid * ux])
  }
  if (paired < count * .72) return
  return samples
}

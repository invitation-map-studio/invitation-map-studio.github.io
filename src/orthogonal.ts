import { mapBounds as frame, type Point, type Road } from './model'
import type { LocalRoad } from './local-roads'
import { drawGridNetwork } from './grid-network'

const center: Point = [700, 605]

// Keep the venue fixed, and leave room for markers near the rotated frame edges.
export function gridPoint(p: Point, angle?: number, inverse = false): Point {
  if (angle === undefined) return p
  const theta = inverse ? -angle : angle, scale = inverse ? 1 / .86 : .86
  const x = p[0] - center[0], y = p[1] - center[1]
  return [center[0] + scale * (x * Math.cos(theta) - y * Math.sin(theta)),
    center[1] + scale * (x * Math.sin(theta) + y * Math.cos(theta))]
}

type Source = Road & { local: boolean }
type Edge = { a:Point; b:Point; length:number; near:number }
type Axis = {
  source: Source
  along: 0 | 1
  cross: number
  spans: number[][]
  cost: number
  local: boolean
}

function edge(a:Point, b:Point): Edge {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const length = Math.hypot(dx, dy)
  const projection = ((center[0] - a[0]) * dx + (center[1] - a[1]) * dy) / (length * length || 1)
  const t = Math.max(0, Math.min(1, projection))
  return {a,b,length,near:Math.hypot(a[0]+t*dx-center[0],a[1]+t*dy-center[1])}
}

function edges(points:Point[]) {
  return points.slice(1).map((b,i)=>edge(points[i],b)).filter(e=>e.length>1 &&
    Math.max(e.a[0],e.b[0]) >= frame[0]-35 && Math.min(e.a[0],e.b[0]) <= frame[2]+35 &&
    Math.max(e.a[1],e.b[1]) >= frame[1]-35 && Math.min(e.a[1],e.b[1]) <= frame[3]+35)
}

function majorRank(highway:string) {
  if (highway === 'motorway' || highway === 'trunk') return 1
  if (highway === 'primary' || highway === 'secondary') return 0
  return 2
}

// Draw only the measured extent of each corridor. Separate pieces keep separate
// spans; unrelated or grade-separated crossings retain a gap in the lower street.
export function gridRoads(roads:Road[], project:(p:Point)=>Point, local:LocalRoad[], addressStreet:string, savedAngle?:number) {
  const sources:Source[] = roads.map(r=>({...r,points:r.points.map(project),local:false}))
  const majorIds = new Set(roads.map(road => road.id))
  for (const r of local) {
    if (majorIds.has(r.id)) continue
    sources.push({...r, version: 1, highway: r.foot ? 'footway' : 'residential', nodes: [], level: '', local: true})
  }
  let best = Infinity, angle = 0
  for (const source of sources) for (const e of edges(source.points)) {
    const cost = e.near + 2000 * Number(source.name !== addressStreet) + 500 * Number(source.local) + 100 / e.length
    if (cost >= best) continue
    const bearing = Math.atan2(e.b[1]-e.a[1], e.b[0]-e.a[0])
    angle = Math.round(bearing/(Math.PI/2))*(Math.PI/2)-bearing
    best = cost
  }
  if (savedAngle !== undefined) angle = savedAngle
  const groups = new Map<string,{source:Source; edges:Edge[]}>()
  for (const source of sources) {
    const points = source.points.map(p => gridPoint(p, angle))
    const parts = edges(points)
    if (!parts.length) continue
    const key=JSON.stringify([source.name || source.id,source.level,source.local])
    const group=groups.get(key) ?? {source,edges:[]}
    group.edges.push(...parts)
    groups.set(key,group)
  }
  const axes:Axis[]=[]
  for (const {source,edges:parts} of groups.values()) {
    // A short turning lane nearest the venue can run across the street it belongs to.
    // Use the accumulated projected length of the street to find its main direction.
    const reach = [0, 0]
    for (const {a,b,near} of parts) {
      const dx = Math.abs(b[0]-a[0]), dy = Math.abs(b[1]-a[1])
      const direction = dx >= dy ? 0 : 1
      reach[direction] += Math.abs(dx-dy) / (1 + near/450)
    }
    const along = reach[0] >= reach[1] ? 0 : 1
    const across = 1-along
    const parallel = parts.filter(({a,b}) => Math.abs(a[along]-b[along]) >= Math.abs(a[across]-b[across]))
      .sort((a,b) => a.near-b.near)
    if (!parallel.length) continue
    const main = parallel.find(e => e.length >= 10) ?? parallel[0]
    const mid = (main.a[across]+main.b[across])/2
    const aligned = parallel.filter(e => Math.abs((e.a[across]+e.b[across])/2-mid) < 90)
    const weights=aligned.map(e=>Math.min(e.length,130)/(1+e.near*.012)**2)
    const cross=aligned.reduce((n,e,i)=>n+weights[i]*(e.a[across]+e.b[across])/2,0)/weights.reduce((a,b)=>a+b)
    const spans:number[][]=[]
    const intervals=aligned.map(e=>[Math.max(frame[along],Math.min(e.a[along],e.b[along])),
      Math.min(frame[along+2],Math.max(e.a[along],e.b[along]))]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0])
    for (const [a,b] of intervals) {
      const last=spans.at(-1)
      if (last && a<=last[1]+1) last[1]=Math.max(last[1],b)
      else spans.push([a,b])
    }
    const length=spans.reduce((n,[a,b])=>n+b-a,0)
    const longest = Math.max(...spans.map(([a,b]) => b-a))
    if (!source.local && source.name !== addressStreet && longest < 80) continue
    if (length<12 || cross<frame[across]+8 || cross>frame[across+2]-8) continue
    const cost=(addressStreet && source.name===addressStreet ? -2000:0) + main.near +
      majorRank(source.highway)*85 + (source.name ? 0 : 600) - Math.min(longest,850)*.32
    axes.push({source,along,cross,spans,cost,local:source.local})
  }
  const chosen:Axis[]=[]
  for (const axis of axes.sort((a,b)=>Number(a.local)-Number(b.local) || a.cost-b.cost || a.source.id-b.source.id)) {
    if (chosen.filter(c=>c.local===axis.local).length >= (axis.local?2:8)) continue
    if (chosen.some(c=>c.source.name && c.source.name===axis.source.name)) continue
    const crowded = chosen.some(c => c.along === axis.along && Math.abs(c.cross-axis.cross) < (axis.local ? 15 : 63) &&
      c.spans.some(([a,b]) => axis.spans.some(([x,y]) => Math.min(b,y) - Math.max(a,x) > 35)))
    if (crowded) continue
    chosen.push(axis)
  }
  const network = drawGridNetwork(sources, chosen.map(axis => axis.source), p => gridPoint(p,angle))
  return {angle,...network}
}

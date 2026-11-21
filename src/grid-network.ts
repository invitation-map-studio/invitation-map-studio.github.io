// Keep the same vertex at each real junction while straightening the selected streets.
import { mapBounds, type Point, type Road } from './model'
import type { StreetPath } from './carriageways'

type Source = Road & {local: boolean}
type Vertex = {point: Point; edges: number[]}
type Edge = {from: Vertex; to: Vertex; source: Source; along: 0|1; weight: number}
type Span = {source: Source; along: 0|1; cross: number; lo: number; hi: number; joints: Set<Vertex>}

const streetKey = (road: Source) => JSON.stringify([road.local, road.name || road.id])

// Axis membership and physical connectivity are separate. Two carriageways can
// use the same printing coordinate without bridging a missing section of road.
class Groups {
  private parents: number[]
  constructor(count: number) { this.parents = Array.from({length:count}, (_,i) => i) }
  root(i: number): number {
    while (this.parents[i] !== i) {
      this.parents[i] = this.parents[this.parents[i]]
      i = this.parents[i]
    }
    return i
  }
  join(a: number,b: number) { this.parents[this.root(a)] = this.root(b) }
}

export function drawGridNetwork(sources: Source[], selected: Source[], rotate: (p: Point) => Point): StreetPath[] {
  const selectedByKey = new Map(selected.map(road => [streetKey(road),road]))
  const vertices = new Map<string|number, Vertex>()
  const edges: Edge[] = []
  for (const road of sources) {
    if (!selectedByKey.has(streetKey(road))) continue
    const points = road.points.map(rotate)
    const vertex = (i: number) => {
      const key = road.nodes[i] ?? road.id + ':' + i
      let node = vertices.get(key)
      if (!node) { node = {point:points[i],edges:[]}; vertices.set(key,node) }
      return node
    }
    for (let i=1; i<points.length; i++) {
      const a = points[i-1], b = points[i]
      if ([0,1].some(k => Math.max(a[k],b[k]) < mapBounds[k]-45 ||
          Math.min(a[k],b[k]) > mapBounds[k+2]+45)) continue
      const dx = Math.abs(b[0]-a[0]), dy = Math.abs(b[1]-a[1])
      if (dx+dy < .001) continue
      const along = dx >= dy ? 0 : 1
      const from = vertex(i-1), to = vertex(i)
      const index = edges.length
      edges.push({from,to,along,source:road,weight:Math.min(150,Math.max(dx,dy))})
      from.edges.push(index)
      to.edges.push(index)
    }
  }
  const axes = new Groups(edges.length), pieces = new Groups(edges.length)
  for (const v of vertices.values()) {
    for (const i of v.edges) for (const j of v.edges) {
      if (j <= i || edges[i].along !== edges[j].along) continue
      axes.join(i,j)
      if (streetKey(edges[i].source) === streetKey(edges[j].source)) pieces.join(i,j)
    }
  }
  const pieceEdges = new Map<number,number[]>()
  edges.forEach((_,i) => {
    const id = pieces.root(i), part = pieceEdges.get(id)
    if (part) part.push(i)
    else pieceEdges.set(id,[i])
  })
  const fragments = [...pieceEdges.values()].map(indices => {
    const first = indices[0], {source,along} = edges[first], across = 1-along
    const nodes = new Set<Vertex>()
    let weighted = 0, weight = 0, lo = Infinity, hi = -Infinity
    for (const i of indices) {
      const {from,to,weight:w} = edges[i]
      nodes.add(from); nodes.add(to)
      weighted += w * (from.point[across]+to.point[across])/2
      weight += w
      lo = Math.min(lo,from.point[along],to.point[along])
      hi = Math.max(hi,from.point[along],to.point[along])
    }
    return {first,source,along,nodes,weighted,weight,lo,hi}
  })
  // Co-locate the opposing lanes of a named divided street. They retain
  // independent spans and junction identities, including at bridges.
  for (let i=0;i<fragments.length;i++) {
    const a = fragments[i]
    if (!a.source.oneWay || !a.source.name) continue
    for (const b of fragments.slice(i+1)) {
      if (!b.source.oneWay || a.source.name !== b.source.name || a.source.level !== b.source.level ||
          a.along !== b.along || Math.min(a.hi,b.hi)-Math.max(a.lo,b.lo) < 12) continue
      if (Math.abs(a.weighted/a.weight-b.weighted/b.weight) < 36) axes.join(a.first,b.first)
    }
  }
  const totals = new Map<number,{sum:number; weight:number}>()
  for (const f of fragments) {
    const id = axes.root(f.first), total = totals.get(id) ?? {sum:0,weight:0}
    total.sum += f.weighted; total.weight += f.weight
    totals.set(id,total)
  }
  const cross = (i:number) => {
    const t = totals.get(axes.root(i))!
    return t.sum / t.weight
  }
  const spans: Span[] = []
  for (const f of fragments) {
    const positions: number[] = []
    const joints = new Set<Vertex>()
    for (const v of f.nodes) {
      const branch = v.edges.find(i => edges[i].along !== f.along)
      if (branch !== undefined) { positions.push(cross(branch)); joints.add(v) }
      const incident = v.edges.filter(i => pieces.root(i) === pieces.root(f.first))
      if (branch === undefined && incident.length === 1) positions.push(v.point[f.along])
    }
    if (positions.length < 2) positions.push(f.lo,f.hi)
    const lo = Math.min(...positions), hi = Math.max(...positions)
    // Very short projected turns between the two lanes of a divided street collapse to a point.
    if (hi-lo < 1) continue
    spans.push({along:f.along,source:selectedByKey.get(streetKey(f.source))!,cross:cross(f.first),lo,hi,joints})
  }
  // Merge only touching or overlapping ink of the same street. Keep genuine gaps.
  const merged: Span[] = []
  for (const s of spans.sort((a,b) => a.lo-b.lo)) {
    const prev = merged.find(p => p.source === s.source && p.along === s.along &&
      p.cross === s.cross && p.hi >= s.lo-.01)
    if (!prev) merged.push(s)
    else {
      prev.hi = Math.max(prev.hi,s.hi)
      for (const joint of s.joints) prev.joints.add(joint)
    }
  }
  return outline(merged)
}

function outline(spans: Span[]): StreetPath[] {
  const paths: StreetPath[] = []
  for (const span of spans) {
    const {along,source,cross} = span
    const nearby = spans.filter(s => s.along !== along && (source.local || !s.source.local) &&
      s.lo <= cross+.01 && s.hi >= cross-.01 && s.cross >= span.lo-.01 && s.cross <= span.hi+.01)
    for (const offset of source.local ? [0] : [-7,7]) {
      const at = cross+offset
      let lo = span.lo, hi = span.hi
      const gaps: number[][] = []
      for (const other of nearby) {
        const joined = [...span.joints].some(j => other.joints.has(j))
        const half = other.source.local ? 1 : 7
        if (joined) {
          if (Math.abs(other.cross-lo) < .01) lo -= half
          if (Math.abs(other.cross-hi) < .01) hi += half
          if (offset < 0 && other.lo >= cross-.01 || offset > 0 && other.hi <= cross+.01) continue
        } else if (span.source.id < other.source.id) continue
        const gap = joined ? half : half+4
        gaps.push([other.cross-gap,other.cross+gap])
      }
      let start = lo
      function stroke(end: number) {
        if (end-start < .15) return
        const points: Point[] = along === 0 ? [[start,at],[end,at]] : [[at,start],[at,end]]
        paths.push({road:source,points})
      }
      for (const [a,b] of gaps.sort((a,b) => a[0]-b[0])) {
        stroke(Math.min(a,hi))
        start = Math.max(start,b)
      }
      stroke(hi)
    }
  }
  return paths
}

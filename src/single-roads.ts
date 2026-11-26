import type { Item, Point } from './model'

type Interval = [number, number]
type Axis = {along: 0|1; cross: number; intervals: Interval[]}

// Work from the saved print geometry so switching strokes preserves the exact
// layout, including older drawings and the clearances beneath their labels.
const separation = 14
const epsilon = .025

function union(intervals: Interval[]) {
  const result: Interval[] = []
  for (const [lo,hi] of intervals.sort((a,b) => a[0]-b[0])) {
    const last = result.at(-1)
    if (last && lo <= last[1]+epsilon) last[1] = Math.max(last[1],hi)
    else result.push([lo,hi])
  }
  return result
}

export function savedRoadCenters(items: Item[]): [Point, Point][] {
  const groups = new Map<string,{along:0|1; rails:Map<number,Interval[]>}>()
  for (const road of items) {
    if (road.kind !== 'line' || road.hidden) continue
    const id = /^road-(\d+)-/.exec(road.id)?.[1]
    if (!id) continue
    for (let i=1; i<road.points.length; i++) {
      const a = road.points[i-1], b = road.points[i]
      const along = Math.abs(a[1]-b[1]) < epsilon ? 0 : 1
      const across = 1-along
      if (Math.abs(a[across]-b[across]) >= epsilon) continue
      const key = id+'-'+along
      const group = groups.get(key) ?? {along,rails:new Map<number,Interval[]>()}
      const at = Math.round(a[across]*1000)
      const parts = group.rails.get(at) ?? []
      parts.push([Math.min(a[along],b[along]),Math.max(a[along],b[along])])
      group.rails.set(at,parts)
      groups.set(key,group)
    }
  }
  const axes: Axis[] = []
  for (const {along,rails} of groups.values()) {
    for (const [at,parts] of rails) {
      const opposite = rails.get(at+separation*1000)
      if (!opposite) continue
      const left = union(parts), right = union(opposite), intervals: Interval[] = []
      let i = 0, j = 0
      while (i < left.length && j < right.length) {
        const lo = Math.max(left[i][0],right[j][0]), hi = Math.min(left[i][1],right[j][1])
        if (hi > lo) intervals.push([lo,hi])
        if (left[i][1] < right[j][1]) i++
        else j++
      }
      if (intervals.length) axes.push({along,cross:at/1000+separation/2,intervals})
    }
  }
  const lines: [Point,Point][] = []
  for (const axis of axes) {
    // A junction opens the rail exactly half a road width from its centre.
    // Larger gaps from bridges, cut labels or disconnected streets stay open.
    const half = separation/2
    const junctions = axes.filter(other => other.along !== axis.along &&
      other.intervals.some(([a,b]) => a-half-epsilon <= axis.cross && axis.cross <= b+half+epsilon))
    function end(value: number, direction: number) {
      return junctions.find(other => Math.abs(other.cross-value-direction*half) <= epsilon)?.cross ?? value
    }
    const spans = union(axis.intervals.map(([a,b]) => [end(a,-1),end(b,1)]))
    for (const [a,b] of spans) {
      lines.push(axis.along === 0 ? [[a,axis.cross],[b,axis.cross]] : [[axis.cross,a],[axis.cross,b]])
    }
  }
  return lines
}

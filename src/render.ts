import { savedRoadCenters } from './single-roads'
import { destinationPath } from './symbols'
import { laneLayerVisible, type Item, type Project, type Spec } from './model'
const NS = 'http://www.w3.org/2000/svg'
function svg(tag: string, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS(NS, tag)
  for (const [key, val] of Object.entries(attrs)) el.setAttribute(key, String(val))
  return el
}
// Front-facing bus pictogram; the given point is the centre of its printed symbol.
function busSymbol(x: number, y: number, radius: number, ink: string) {
  const g = svg('g', {transform: `translate(${x} ${y}) scale(${radius/17})`, fill: ink})
  g.append(svg('rect', {x:-15,y:-17,width:30,height:31,rx:6,stroke:'white','stroke-width':2}),
    svg('rect', {x:-11,y:-10,width:22,height:13,rx:2,fill:'white'}),
    svg('rect', {x:-6,y:-14,width:12,height:2,rx:1,fill:'white'}))
  for (const side of [-1,1]) {
    g.append(svg('circle',{cx:side*9,cy:8,r:2.2,fill:'white'}),
      svg('rect',{x:side*9-2.5,y:12,width:5,height:5,rx:1.5}))
  }
  return g
}
function draw(item: Item, ink: string, legacyBus: boolean) {
  const fill = { ink, soft: '#686163', line: '#b9b1ad' }[item.tone]
  if (item.kind === 'line')
    return svg('path', {
      d: item.points.map(([x, y], i) => (i ? 'L' : 'M') + x + ' ' + y).join(' '),
      fill: 'none',
      stroke: item.id.startsWith('local-') ? '#918989' : fill,
      'stroke-width': item.width,
      ...(/^local-(?:addr-)?foot-/.test(item.id) ? { 'stroke-dasharray': '5 4' } : {}),
    })
  if (item.kind === 'text') {
    const el = svg('text', {
      x: item.x,
      y: item.y,
      'font-family': item.font === 'serif' ? 'Noto Serif CJK KR' : 'Noto Sans CJK KR',
      'font-weight': item.weight,
      'font-size': item.size,
      'text-anchor': item.anchor,
      'letter-spacing': item.spacing,
      fill,
    })
    el.textContent = item.text
    if (item.angle) el.setAttribute('transform', `rotate(${item.angle} ${item.x} ${item.y})`)
    if (item.id === 'building-bus-guide' && item.text) {
      const group = svg('g')
      const width = Array.from(item.text).reduce((w,c) => w + (/\s/.test(c) ? .36 : /[a-zA-Z0-9]/.test(c) ? .62 : 1),0)*item.size
      const left = item.anchor === 'start' ? item.x : item.x - width/(item.anchor === 'end' ? 1 : 2)
      if (item.angle) {
        group.setAttribute('transform', el.getAttribute('transform')!)
        el.removeAttribute('transform')
      }
      group.append(busSymbol(left-19,item.y-item.size*.4,12,ink),el)
      return group
    }
    return el
  }
  if (item.kind === 'dot' && item.id.startsWith('transit-stop-')) {
    return svg('circle', {cx: item.x, cy: item.y, r: item.radius,
      fill: '#fff', stroke: ink, 'stroke-width': 2.8})
  }
  if (item.kind === 'dot' && (legacyBus || item.id.startsWith('building-bus-mark-')))
    return busSymbol(item.x,item.y,legacyBus ? Math.max(15,item.radius) : item.radius,ink)
  if (item.kind === 'dot' && item.id.startsWith('building-mark-'))
    return svg('rect', { x: item.x - item.radius, y: item.y - item.radius, width: 2 * item.radius,
      height: 2 * item.radius, rx: 1, fill })
  if (item.kind === 'dot') return svg('circle', { cx: item.x, cy: item.y, r: item.radius, fill })
  const g = svg('g', {
    transform: `translate(${item.x} ${item.y}) scale(${item.radius / 28})`,
    fill,
  })
  // Historical files call the destination symbol "flower". Its anchor remains the tip.
  g.append(svg('path', {d: destinationPath}))
  g.append(svg('circle', {cx: 0, cy: -37, r: 10, fill: '#fff'}))
  return g
}
function legacyBusMarks(spec: Spec) {
  return new Set(spec.items.filter(i => i.kind === 'text' &&
    i.id.startsWith('building-name-') && i.text.endsWith(' 정류장')).map(i => i.id.replace('building-name-', 'building-mark-')))
}

// The generator emits landmarks in priority order. A building's name and
// symbol count as one place, even when one of them was hidden manually.
export function displayItems(spec: Spec, buses = legacyBusMarks(spec)) {
  let items = spec.items.filter(item => laneLayerVisible(spec, item))
  if (spec.gridAngle !== undefined && spec.singleRoads) {
    const isRoad = (i: Item) => i.kind === 'line' && /^road-\d+-/.test(i.id)
    const first = items.findIndex(isRoad)
    if (first >= 0) {
      const centers = (spec.roadCenters ?? savedRoadCenters(items)).map((points,i): Item => ({
        kind:'line', id:'road-single-'+i, width:2.8, points, tone:'soft', footer:false, hidden:false,
      }))
      items = items.filter(i => !isRoad(i))
      items.splice(first,0,...centers)
    }
  }
  const limit = spec.buildingLimit ?? (spec.gridAngle === undefined ? Infinity : 3)
  if (limit === Infinity) return items
  const visible = new Set(spec.items.filter(i => !i.hidden).map(i => i.id))
  const omit = new Set<string>()
  let count = 0
  for (const mark of spec.items) {
    if (!mark.id.startsWith('building-mark-') || buses.has(mark.id)) continue
    const name = mark.id.replace('building-mark-', 'building-name-')
    if (mark.hidden && !visible.has(name)) continue
    if (++count > limit) {
      omit.add(mark.id)
      omit.add(name)
    }
  }
  return items.filter(i => !omit.has(i.id))
}
export function render(project: Project, mapOnly = false, interactive = false) {
  const height = mapOnly ? 1140 : 1440
  const root = svg('svg', {
    width: '140mm',
    height: `${height / 10}mm`,
    viewBox: `0 0 1400 ${height}`,
    role: 'img',
    'aria-label': mapOnly ? '오시는 길 약도' : project.name + ' 약도',
  })
  const buses = legacyBusMarks(project.spec)
  for (const item of displayItems(project.spec, buses)) {
    if (item.hidden || (mapOnly && item.footer)) continue
    const isTitle = item.kind === 'text' && (item.id === 'ref-0' || item.id === 'title')
    const el = draw(
      isTitle && project.spec.layout !== 'minimal' && project.review.status === 'pending'
        ? {
            ...item,
            size: 24,
            spacing: 0,
            tone: 'soft',
            text:
              project.origin === 'reference'
                ? '원본 재현 · 위치 재확인 전'
                : '확인 필요 시안 · 출입구 미확인',
          }
        : item,
      project.spec.ink, buses.has(item.id),
    )
    if (interactive) el.setAttribute('data-item', item.id)
    root.append(el)
  }
  if (project.origin === 'osm') {
    const source = svg('desc')
    source.textContent = 'Map data © OpenStreetMap contributors · https://www.openstreetmap.org/copyright'
    root.prepend(source)
  }
  return root
}
export const serialize = (p: Project, mapOnly = false) =>
  new XMLSerializer().serializeToString(render(p, mapOnly))

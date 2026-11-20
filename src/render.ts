import type { Item, Project } from './model'
const NS = 'http://www.w3.org/2000/svg'
function svg(tag: string, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS(NS, tag)
  for (const [key, val] of Object.entries(attrs)) el.setAttribute(key, String(val))
  return el
}
function draw(item: Item, ink: string, vicinity: boolean) {
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
    return el
  }
  if (item.kind === 'dot' && item.id.startsWith('transit-stop-')) {
    if (vicinity) return svg('circle', {cx: item.x, cy: item.y, r: item.radius,
      fill: '#fff', stroke: ink, 'stroke-width': 2.8})
    const g = svg('g', {transform: `translate(${item.x} ${item.y})`})
    g.append(svg('circle', {r: item.radius, fill: ink, stroke: '#fff', 'stroke-width': 3}))
    const letter = svg('text', {x: 0, y: 7, 'text-anchor': 'middle', 'font-size': 20,
      'font-family': 'Noto Sans CJK KR', 'font-weight': 400, fill: '#fff'})
    letter.textContent = item.id.slice('transit-stop-'.length)
    g.append(letter)
    return g
  }
  if (item.kind === 'dot' && item.id.startsWith('building-mark-'))
    return svg('rect', { x: item.x - item.radius, y: item.y - item.radius, width: 2 * item.radius,
      height: 2 * item.radius, rx: 1, fill })
  if (item.kind === 'dot') return svg('circle', { cx: item.x, cy: item.y, r: item.radius, fill })
  const g = svg('g', {
    transform: `translate(${item.x} ${item.y}) scale(${item.radius / 28})`,
    fill,
  })
  if (vicinity && item.id === 'destination') {
    // Anchor the tip at the measured venue point in the editor and all exports.
    g.append(svg('path', {d: 'M0 0 C-5 -8 -20 -24 -20 -37 A20 20 0 1 1 20 -37 C20 -24 5 -8 0 0 Z'}))
    g.append(svg('circle', {cx: 0, cy: -37, r: 10, fill: '#fff'}))
    return g
  }
  for (let angle = 0; angle < 360; angle += 60)
    g.append(svg('ellipse', { cx: 0, cy: -14.25, rx: 5, ry: 13.75, transform: `rotate(${angle})` }))
  g.append(svg('circle', { r: 6 }))
  return g
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
  for (const item of project.spec.items) {
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
      project.spec.ink, Boolean(project.spec.style),
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

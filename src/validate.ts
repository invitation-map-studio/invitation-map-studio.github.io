import { coordinate, iso, pending, type Item, type Project } from './model'
const bad = () => {
  throw Error('지원하지 않는 프로젝트 형식이거나 값의 허용 범위를 벗어났습니다.')
}
function record(v: unknown, keys: string[]): Record<string, any> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    bad()
  return v as Record<string, any>
}
const str = (v: unknown, max = 160) =>
  typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v)
const num = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && lo <= v && v <= hi
const nat = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0
const point = (p: any, geo = false) =>
  Array.isArray(p) &&
  p.length === 2 &&
  (geo ? coordinate(p[1], p[0]) : p.every((v) => num(v, -2000, 4000)))
const choice = (v: unknown, ...values: unknown[]) => values.includes(v)
export function importProject(raw: string): Project {
  if (new Blob([raw]).size > 5 * 1024 * 1024)
    throw Error('프로젝트 파일은 5 MiB까지 열 수 있습니다.')
  const p = record(JSON.parse(raw), [
    'schema',
    'id',
    'name',
    'address',
    'origin',
    'spec',
    'geo',
    'lastSuccessfulFetchAt',
    'expiresAt',
    'lastAccessedAt',
    'imported',
    'refreshFailed',
    'review',
  ])
  if (
    p.schema !== 1 ||
    !str(p.name, 100) ||
    !str(p.address) ||
    !choice(p.origin, 'osm', 'reference')
  )
    bad()
  const spec = record(p.spec, ['items', 'ink', 'layout', 'style'])
  if (spec.style !== undefined && (spec.style !== 'vicinity' || spec.layout !== 'minimal')) bad()
  if (spec.layout !== undefined && spec.layout !== 'minimal') bad()
  if (!/^#[a-f\d]{6}$/i.test(spec.ink) || !Array.isArray(spec.items) || spec.items.length > 20000)
    bad()
  const ids = new Set<string>()
  let vertices = 0
  for (const obj of spec.items) {
    const common = ['id', 'tone', 'kind', 'hidden', 'footer']
    const extra =
      obj?.kind === 'line'
        ? ['width', 'points']
        : obj?.kind === 'text'
          ? ['text', 'x', 'y', 'size', 'font', 'weight', 'anchor', 'spacing', 'angle']
          : ['x', 'y', 'radius']
    const i = record(obj, [...common, ...extra])
    if (
      !str(i.id, 100) ||
      !i.id ||
      ids.has(i.id) ||
      !choice(i.tone, 'ink', 'soft', 'line') ||
      typeof i.footer !== 'boolean' ||
      typeof i.hidden !== 'boolean'
    )
      bad()
    ids.add(i.id)
    if (i.kind === 'line') {
      if (
        !num(i.width, 0.1, 30) ||
        !Array.isArray(i.points) ||
        i.points.length < 2 ||
        i.points.some((v: any) => !point(v))
      )
        bad()
      vertices += i.points.length
    } else {
      if (!point([i.x, i.y])) bad()
      if (i.kind === 'text') {
        if (
          !str(i.text) ||
          !choice(i.font, 'serif', 'sans') ||
          !choice(i.weight, 400, 700) ||
          !choice(i.anchor, 'start', 'middle', 'end') ||
          !num(i.size, 8, 100) ||
          !num(i.spacing, -3, 20) ||
          !num(i.angle, -360, 360)
        )
          bad()
      } else if (!choice(i.kind, 'dot', 'flower') || !num(i.radius, 0.1, 100)) bad()
    }
  }
  if (p.origin === 'osm') {
    const g = record(p.geo, ['source', 'place', 'roads', 'landmarks'])
    const a = record(g.place, ['address', 'id', 'lat', 'lon', 'entrance', 'radius'])
    if (
      g.source !== 'osm' ||
      !str(a.address) ||
      !str(a.id, 100) ||
      !str(a.entrance, 60) ||
      !coordinate(a.lat, a.lon) ||
      !num(a.radius, 50, 2000) ||
      !Array.isArray(g.roads) ||
      (!g.roads.length && !(spec.layout === 'minimal' &&
        spec.items.some((i: Item) => i.kind === 'line' && /^local-(?:addr-)?(?:foot|lane)-\d+-\d+$/.test(i.id)))) ||
      !Array.isArray(g.landmarks) ||
      g.roads.length + g.landmarks.length > 20000
    )
      bad()
    for (const road of g.roads) {
      const r = record(road, ['id', 'version', 'name', 'highway', 'level', 'nodes', 'points'])
      if (
        !nat(r.id) ||
        !nat(r.version) ||
        !str(r.name) ||
        !str(r.highway, 40) ||
        !str(r.level, 60) ||
        !Array.isArray(r.nodes) ||
        !Array.isArray(r.points) ||
        r.points.length < 2 ||
        r.points.length !== r.nodes.length ||
        r.nodes.some((n: any) => !nat(n)) ||
        r.points.some((v: any) => !point(v, true))
      )
        bad()
      vertices += r.nodes.length
    }
    for (const lm of g.landmarks) {
      const l = record(lm, ['id', 'version', 'name', 'point'])
      if (!str(l.id) || !nat(l.version) || !str(l.name) || !point(l.point, true)) bad()
    }
  } else if (p.geo !== null) bad()
  if (vertices > 100000) bad()
  // An imported file is editable historical material. Freshness and review never transfer.
  return {
    schema: 1,
    id: crypto.randomUUID(),
    name: p.name,
    address: p.address,
    origin: p.origin,
    spec: p.spec,
    geo: p.geo,
    imported: true,
    lastSuccessfulFetchAt: null,
    expiresAt: null,
    lastAccessedAt: iso(),
    review: pending(),
  }
}

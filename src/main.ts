import './style.css'
import reference from './reference.json'
import fixture from '../data/dasan74.json'
import { catalog, datasetAt } from './catalog'
import { unlock, canSetup } from './lock'
import {
  DAY,
  iso,
  fresh,
  normalize,
  pending,
  placeKey,
  type Geography,
  type Item,
  type Place,
  type Project,
  type Spec,
} from './model'
import { addresses, buildingItems, fetchGeography, layout } from './geography'
import { canonicalAddress, parseRoadAddress, mentionsVenue } from './road-address'
import { render, serialize } from './render'
import {
  archive,
  archiveList,
  erase,
  fileKey,
  projects,
  readArchive,
  resolvePlace,
  type FetchOutcome,
  save,
  savedGeography,
  seedGeography,
  snapshots,
} from './store'
import { importProject } from './validate'
import { stationRadius, transitItems } from './transit'
import { buildingsNear } from './buildings'
import { indexedRoads } from './major-roads'
import { closeNaver, showNaver } from './naver'
import { localLocationCheck, markerPoint } from './location-check'
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const field = (id: string) => el<HTMLInputElement>(id)
const sel = (id: string) => el<HTMLSelectElement>(id)
const date = (v: string | null) =>
  v
    ? new Intl.DateTimeFormat('ko-KR', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Seoul',
      }).format(new Date(v))
    : '기록 없음'
const knownGeo = fixture.geo as Geography
const verifiedChecks = [
  '장소와 건물 식별',
  '목적지와 도로의 좌우 관계',
  '주요 도로 연결과 갈림길 순서',
  '방위와 랜드마크 상대 위치',
]
for (const text of verifiedChecks) {
  const label = document.createElement('label'),
    box = document.createElement('input')
  label.className = 'check'
  box.type = 'checkbox'
  label.append(box, text)
  el('review-checks').append(label)
}
function createProject(geo: Geography | null, name: string, details = ''): Project {
  const spec = geo ? layout(geo, name) : (structuredClone(reference) as Spec)
  const detailLine = spec.items.find((item) => item.id === 'details')
  if (detailLine?.kind === 'text') detailLine.text = details
  return {
    schema: 1,
    id: crypto.randomUUID(),
    name,
    address: geo?.place.address ?? '경기도 남양주시 다산순환로 20',
    origin: geo ? 'osm' : 'reference',
    spec,
    geo,
    lastSuccessfulFetchAt: null,
    expiresAt: null,
    lastAccessedAt: iso(),
    imported: false,
    review: pending(),
  }
}
function sample74() {
  const p = createProject(knownGeo, fixture.name)
  p.lastSuccessfulFetchAt = fixture.fetchedAt
  p.expiresAt = iso(Date.parse(fixture.fetchedAt) + DAY)
  return p
}
let current: Project,
  history: Project[] = [],
  selected = '',
  busy: AbortController | null = null
let urls: string[] = []
let searching = false
let backgroundRoads: AbortController | undefined
let interactions = 0
for (const event of ['pointerdown', 'keydown', 'input'])
  el('studio').addEventListener(event, () => { interactions++ }, { capture: true })
function status(message: string, error = false, id = searching ? 'search-status' : 'status') {
  const output = el(id)
  output.textContent = message
  output.classList.toggle('error', error)
}
function clearFiles() {
  for (const u of urls) URL.revokeObjectURL(u)
  urls = []
  el('downloads').replaceChildren()
}
function link(file: Blob, name: string, parent: HTMLElement, caption = name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  urls.push(a.href)
  a.download = name
  a.textContent = caption
  parent.append(a)
  return a
}
function action(action: (s: AbortSignal) => Promise<void>, origin: 'search' | 'studio' | 'review' = 'studio') {
  return async () => {
    if (busy) return
    busy = new AbortController()
    searching = origin === 'search'
    const reviewButton = el<HTMLButtonElement>('review')
    reviewButton.disabled = true
    reviewButton.textContent = origin === 'review' ? '저장 중…' : searching ? '지도 조회 중…' : '작업 진행 중…'
    const controls = searching
      ? document.querySelectorAll<HTMLElement>(
          '#search,#candidates,aside section:not(:first-child),#naver',
        )
      : document.querySelectorAll<HTMLElement>('#studio aside')
    const cancel = el(searching ? 'search-cancel' : 'cancel')
    cancel.hidden = false
    controls.forEach((control) => (control.inert = true))
    if (searching) {
      el('search-preview').hidden = true
      el('search-submit').textContent = '조회 중…'
      el('search-submit').setAttribute('aria-busy', 'true')
    }
    try {
      await action(busy.signal)
    } catch (e) {
      status(
        e instanceof Error
          ? e.name === 'AbortError'
            ? '작업을 취소했습니다.'
            : e.message
          : '작업에 실패했습니다.',
        true,
        origin === 'review' ? 'review-status' : undefined,
      )
    } finally {
      busy = null
      reviewButton.disabled = false
      reviewButton.textContent = '대조 기록 저장'
      controls.forEach((control) => (control.inert = false))
      cancel.hidden = true
      if (searching) {
        el('search-submit').textContent = '주소로 약도 만들기'
        el('search-submit').removeAttribute('aria-busy')
      }
      searching = false
    }
  }
}
function hook(id: string, fn: (s: AbortSignal) => Promise<void>) {
  el(id).addEventListener('click', action(fn))
}
function searchAction(fn: (signal: AbortSignal) => Promise<void>) {
  return action(fn, 'search')
}
el('cancel').onclick = el('search-cancel').onclick = () => busy?.abort()
function clearSearch() {
  backgroundRoads?.abort()
  el('search-preview').hidden = true
  el('search-status').textContent = ''
  el('candidates').replaceChildren()
}
el('search').addEventListener('input', clearSearch)
const editable = () => current.spec.items.filter((i) => i.kind !== 'line')
const item = () => current.spec.items.find((i) => i.id === selected)
function fields() {
  const i = item()
  if (!i || i.kind === 'line') return
  field('caption').disabled = i.kind !== 'text'
  field('caption').value = i.kind === 'text' ? i.text : ''
  field('x').value = String(i.x)
  field('y').value = String(i.y)
  field('visible').checked = !i.hidden
  field('ink').value = current.spec.ink
  sel('element').value = i.id
}
let naverSubject = ''
function paint() {
  if (!current) return
  const subject = JSON.stringify([current.address, markerPoint(current)])
  if (naverSubject !== subject) {
    const container = el('naver-map')
    closeNaver(container)
    container.replaceChildren()
    naverSubject = subject
  }
  clearFiles()
  el('paper').replaceChildren(render(current, field('maponly').checked, true))
  el('project-title').textContent = current.name
  el('project-address').textContent = current.address
  const type =
    current.geo?.place.entrance === 'site-bbox-center'
      ? '시설 영역 중심 · 입구 미확인'
      : current.geo?.place.entrance === 'site-centroid'
        ? '단지 중심 · 입구 미확인'
        : current.geo
          ? '주소 대표점 · 입구 미확인'
          : '첨부 배치 · 현행 입구 미확인'
  const review =
    current.review.status === 'checked'
      ? '사용자 위치 대조 ' + date(current.review.verifiedAt)
      : '사용자 대조 기록 없음'
  el('meta').textContent = [
    type,
    review,
    '자료 조회 ' + date(current.lastSuccessfulFetchAt) + ' (한국시간)',
    current.origin === 'reference' ? '다산20 기준 자료' : '',
    current.imported ? '가져온 보관본 · 최신성 미확인' : '',
    current.refreshFailed ? '이전 조회본 · 갱신 실패' : '',
  ]
    .filter(Boolean)
    .join('  /  ')
  el('osm-credit').hidden = current.origin !== 'osm'
  const minimal = current.spec.layout === 'minimal'
  el('coverage').textContent = minimal ? [
    current.spec.items.some(i => i.id.startsWith('road-')) ? '' : '이 범위에 표시할 큰길 자료가 없습니다.',
    current.spec.items.some(i => i.id.startsWith('building-name-')) ? '' : '이 약도에 표시된 주변 건물명이 없습니다.',
    current.spec.items.some(i => i.id.startsWith('transit-guide-')) ? '' : '1 km 이내에 등록된 지하철역이 없습니다.',
  ].filter(Boolean).join(' ') : ''
  const check = localLocationCheck(current)
  el('location-result').textContent = check ? '자동 대조 · ' + check.message : ''
  const source = el<HTMLAnchorElement>('location-source')
  source.hidden = !check?.source
  if (check?.source) source.href = check.source
  el<HTMLAnchorElement>('review-map').href =
    'https://map.naver.com/p/search/' + encodeURIComponent(current.address)
  const entries = editable()
  const buildingNames = new Map<string, string>()
  for (const i of entries)
    if (i.kind === 'text' && i.id.startsWith('building-name-'))
      buildingNames.set(i.id.replace('building-name-', 'building-mark-'), i.text)
  sel('element').replaceChildren(
    ...entries.map(
      (i) =>
        new Option(
          i.kind === 'text'
            ? i.text || '빈 안내 문구'
            : i.kind === 'flower'
              ? '꽃 목적지 표식'
              : i.id.startsWith('transit-stop-') ? '역 표식 ' + i.id.slice(-1)
              : i.id.startsWith('building-mark-') ? (buildingNames.get(i.id) ?? '건물') + ' 표식'
              : i.id.startsWith('junction-') ? '교차로 표식' : '시설 점 ' + i.id,
          i.id,
        ),
    ),
  )
  if (!entries.some((i) => i.id === selected))
    selected = (entries.find((i) => i.kind === 'flower') ?? entries[0])?.id ?? ''
  fields()
  el<HTMLButtonElement>('undo').disabled = !history.length
  el<HTMLButtonElement>('refresh').disabled = !current.geo
  field('review-note').value = current.review.note
  field('review-source').value = current.review.evidence?.url ?? ''
  for (const b of el('review-checks').querySelectorAll('input'))
    b.checked = current.review.status === 'checked'
  status(current.review.status === 'checked' ? '대조 기록을 저장했습니다. ' + date(current.review.verifiedAt) : '', false, 'review-status')
}
async function library() {
  const list = (await projects()).sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt))
  sel('saved').replaceChildren(
    ...list.map((p) => new Option(p.name + ' · ' + date(p.lastAccessedAt), p.id)),
  )
  sel('saved').value = current.id
  const area = el('archives')
  area.replaceChildren()
  const files = await archiveList(current.id)
  if (!files.length) area.textContent = '이 프로젝트에서 보관한 ZIP이 없습니다.'
  for (const a of files) {
    const b = document.createElement('button')
    b.textContent = date(a.createdAt) + ' ZIP 받기'
    b.onclick = action(async () => {
      const checked = await readArchive(a.key)
      if (!checked) throw Error('보관 파일의 무결성을 확인할 수 없습니다.')
      link(checked.zip, checked.name, el('downloads')).click()
    })
    area.append(b)
  }
}
async function use(p: Project, message: string, previous?: Project | null) {
  // Older saved drawings keep their edits while gaining the nearby station layer.
  if (p.geo && !p.spec.items.some(i => i.id.startsWith('transit-')))
    p.spec.items.push(...transitItems(p.geo.place))
  if (p.geo && !p.imported && p.spec.layout === 'minimal' &&
      !p.spec.items.some(item => item.id.startsWith('building-'))) {
    const place = p.geo.place
    const prior = previous?.geo && placeKey(previous.geo.place) === placeKey(place) ? previous : undefined
    const buildings = await buildingsNear(place).catch(() => undefined)
    if (buildings) {
      const additions = buildingItems(p.spec, place, p.name, buildings)
      if (prior?.geo) {
        const oldLayout = layout(prior.geo, prior.name)
        const baseline = new Map(buildingItems(oldLayout, place, prior.name, buildings).map(i => [i.id, i]))
        const edits = new Map(prior.spec.items.map(i => [i.id, i]))
        p.spec.items.push(...additions.map(i => sameItem(baseline.get(i.id), i) ? edits.get(i.id) ?? i : i))
      } else p.spec.items.push(...additions)
    } else if (prior) {
      p.spec.items.push(...prior.spec.items.filter(i => i.id.startsWith('building-')))
    }
  }
  current = p
  current.lastAccessedAt = iso()
  history = []
  selected = ''
  if (!searching) clearSearch()
  el('candidates').replaceChildren()
  paint()
  await save(current)
  await library()
  status(searching ? p.name + ' 약도를 열었습니다. ' + message : message)
  if (searching) el('search-preview').hidden = false
}
async function modify(next: Project) {
  next.lastAccessedAt = iso()
  await save(next)
  history.push(structuredClone(current))
  if (history.length > 25) history.shift()
  current = next
  paint()
  await library()
  status('이 기기에 편집 내용을 저장했습니다.')
}
function sameItem(a: Item | undefined, b: Item) {
  return JSON.stringify(a) === JSON.stringify(b)
}
function revised(old: Project, geo: Geography, name: string): Project {
  const p = createProject(geo, name),
    original = layout(old.geo!, old.name)
  const previous = new Map(original.items.map((i) => [i.id, i])),
    edits = new Map(old.spec.items.map((i) => [i.id, i]))
  p.spec.ink = old.spec.ink
  p.spec.items = p.spec.items.map((i) =>
    i.footer || sameItem(previous.get(i.id), i) ? (edits.get(i.id) ?? i) : i,
  )
  return p
}
async function make(place: Place, name: string, force: boolean, signal: AbortSignal, details = '') {
  const footer = current.spec.items.find((item) => item.id === 'details')
  let old =
    current.geo && (!searching || current.spec.layout === 'minimal') &&
    placeKey(current.geo.place) === placeKey(place) &&
    current.name === name &&
    (!searching || (footer?.kind === 'text' && footer.text === details))
      ? current
      : null
  status('지도 자료를 확인하고 있습니다.')
  let checkedMarker = ''
  function checkLocation() {
    const key = JSON.stringify([current.address, markerPoint(current)])
    if (naverKey && !signal.aborted && checkedMarker !== key) {
      checkedMarker = key
      void checkWithNaver()
    }
  }
  async function displaySnapshot(result: FetchOutcome) {
    const { snap, state } = result,
      changed = old && JSON.stringify(old.geo) !== JSON.stringify(snap.geo)
    const p =
      old && changed ? revised(old, snap.geo, name) : (old ?? createProject(snap.geo, name, details))
    p.lastSuccessfulFetchAt = snap.lastSuccessfulFetchAt
    p.expiresAt = snap.expiresAt
    p.imported = false
    p.refreshFailed = state === 'failed'
    await use(
      p,
      state === 'failed'
        ? '이전 조회본 · 갱신 실패. ' + result.error
        : state === 'reused'
          ? '저장본 재사용 · 외부 조회를 생략했습니다.'
          : changed
            ? '갱신 완료 · 변경된 지리 자료를 새 버전으로 저장했습니다.'
            : '갱신 완료',
      changed ? old : undefined,
    )
  }
  if (searching) {
    const stored = await savedGeography(place)
    signal.throwIfAborted()
    if (stored && !fresh(stored, Date.now())) {
      if (!old) {
        old = createProject(stored.geo, name, details)
        old.lastSuccessfulFetchAt = stored.lastSuccessfulFetchAt
        old.expiresAt = stored.expiresAt
      }
      await use(old, '지금 인쇄할 수 있습니다. 최신 도로 자료도 확인하고 있습니다.')
      checkLocation()
      const draft = old
      const whenShown = interactions
      backgroundRoads?.abort()
      const controller = new AbortController()
      backgroundRoads = controller
      void resolvePlace(place, false, () => fetchGeography(place, controller.signal, true), controller.signal)
        .then(async result => {
          if (controller.signal.aborted || current !== draft) return
          // Never replace an in-progress edit, export, or completed download.
          if (busy || urls.length || interactions !== whenShown) {
            status(result.state === 'failed' ? '보관된 도로 자료로 만든 약도입니다.' :
              '최신 도로 자료를 받았습니다. 주소로 다시 만들면 반영됩니다.', false, 'search-status')
            return
          }
          await searchAction(async () => {
            await displaySnapshot(result)
            checkLocation()
          })()
        })
        .catch(() => {
          if (!controller.signal.aborted && current === draft)
            status('최신 도로 조회가 지연되어 보관된 약도를 사용합니다.', false, 'search-status')
        })
        .finally(() => {
          if (backgroundRoads === controller) backgroundRoads = undefined
        })
      return
    }
  }
  let result
  try {
    result = await resolvePlace(place, force, () => fetchGeography(place, signal, searching || current.spec.layout === 'minimal'), signal)
  } catch (e) {
    if (old && !signal.aborted) {
      old.refreshFailed = true
      paint()
      await save(old)
      status('이전 조회본 · 갱신 실패. ' + (e instanceof Error ? e.message : '조회 오류'), true)
      return
    }
    throw e
  }
  signal.throwIfAborted()
  await displaySnapshot(result)
  checkLocation()
}
function isDasan(address: string) {
  return [fixture.address, '남양주시 다산중앙로82번안길 74', '다산중앙로82번안길 74'].includes(
    address,
  )
}
el('search').onsubmit = (e) => {
  e.preventDefault()
  void searchAction(async (signal) => {
    clearSearch()
    const input = field('address').value
    if (!input.trim()) throw Error('도로명주소를 입력해 주세요. 예: 세종대로 124')
    const parsed = parseRoadAddress(input)
    const address = canonicalAddress(parsed.address), details = parsed.details
    const name = normalize(field('placename').value)
    const area = el('candidates')
    if (isDasan(address)) {
      await makeAddress(knownGeo.place, name || fixture.name, signal, details, knownGeo, fixture.fetchedAt)
      return
    }
    status('도로명과 건물번호로 후보를 찾고 있습니다.')
    const registered = catalog.filter(
      (r) => r.address === address || r.address.endsWith(' ' + address),
    )
    const named = registered.filter((r) => name === r.name || mentionsVenue(details, r.name))
    const venue = named.length === 1 ? named[0] : registered.length === 1 && registered[0].address === address ? registered[0] : undefined
    if (venue) {
      const geo = await venue.load()
      await makeAddress(geo.place, name || venue.name, signal, details, geo)
      return
    }
    const stored = (await snapshots())
      .map((s) => s.geo.place)
      .filter((p) => normalize(p.address) === address)
    let list: Place[]
    try {
      list = await navigator.locks.request('wedding-map-provider', { signal }, () =>
        addresses(address, signal, registered.length === 0 && !stored.length),
      )
    } catch (error) {
      if ((!registered.length && !stored.length) || signal.aborted) throw error
      list = []
    }
    for (const place of stored) if (!list.some(p => p.id === place.id)) list.push(place)
    for (const row of registered) {
      if (list.some((p) => p.id === row.site)) continue
      const geo = await row.load()
      list.unshift({ ...geo.place, address })
    }
    if (!list.length)
      throw Error(
        '이 주소에 연결된 OSM 건물번호가 없습니다. 주소를 확인하거나 검증한 프로젝트 JSON을 열어 주세요.',
      )
    const namedPlaces = list.filter(p => 'venueName' in p && typeof p.venueName === 'string' &&
      p.venueName && (name === p.venueName || mentionsVenue(details, p.venueName)))
    if (namedPlaces.length === 1) list = namedPlaces
    if (list.length === 1) {
      await selectCandidate(list[0], name, details, signal)
      return
    }
    if (stored.length) {
      const b = document.createElement('button')
      b.textContent = '같은 주소의 다른 후보 다시 조회'
      b.onclick = searchAction(async (s) => {
        status('주소 후보를 다시 조회하고 있습니다.')
        const found = await navigator.locks.request('wedding-map-provider', { signal: s }, () =>
          addresses(address, s),
        )
        area.replaceChildren()
        showCandidates(found, name, details)
        status(found.length ? '조회한 위치를 선택해 주세요.' : '추가 후보가 없습니다.')
      })
      area.append(b)
    }
    status('조회한 대표점 중 제작할 위치를 선택해 주세요. 행정구역과 입구를 확인하세요.')
    showCandidates(list, name, details)
  })()
}
async function makeAddress(place: Place, name: string, signal: AbortSignal, details: string,
  fallback?: Geography, fetchedAt = datasetAt) {
  status('큰길과 주변 건물, 가까운 지하철역을 찾고 있습니다.')
  let seed
  try {
    seed = await indexedRoads(place, signal)
  } catch (error) {
    if (signal.aborted) throw error
  }
  const geo = seed?.geo ?? fallback
  if (geo) await seedGeography(geo, seed?.fetchedAt ?? fetchedAt)
  const frame = geo?.place ?? { ...place, radius: stationRadius(place) }
  await make(frame, name, false, signal, details)
}

function registeredCandidate(p: Place) {
  return catalog.find(r => r.site === p.id &&
    (r.address === p.address || r.address.endsWith(' ' + p.address)))
}

async function selectCandidate(p: Place, name: string, details: string, signal: AbortSignal) {
  const registered = registeredCandidate(p)
  if (registered) {
    const geo = await registered.load()
    await makeAddress(geo.place, name || registered.name, signal, details, geo)
  } else {
    const { id, address, entrance, lat, lon, radius } = p
    const venue = 'venueName' in p && typeof p.venueName === 'string' ? p.venueName : ''
    await makeAddress({ id, address, entrance, lat, lon, radius }, name || venue || address, signal, details)
  }
}

function showCandidates(list: Place[], name: string, details: string) {
  for (const p of list) {
    const registered = registeredCandidate(p)
    const b = document.createElement('button')
    b.textContent = [
      registered?.name || ('display' in p ? p.display : ''),
      p.address,
      p.id,
      p.lat.toFixed(5) + ', ' + p.lon.toFixed(5),
    ]
      .filter(Boolean)
      .join(' · ')
    b.onclick = searchAction(signal => selectCandidate(p, name, details, signal))
    el('candidates').append(b)
  }
}
hook('refresh', (s) => make(current.geo!.place, current.name, true, s))
hook('open', async () => {
  const p = (await projects()).find((p) => p.id === sel('saved').value)
  if (p) await use(p, '저장된 프로젝트를 열었습니다.')
})
hook('dasan20', () =>
  use(
    createProject(null, '파로스컨벤션'),
    '원본 디자인 재현 · 기존 안내의 현행 위치와 교통 정보는 재확인이 필요합니다.',
  ),
)
hook('dasan74', () =>
  use(sample74(), '공식 단지 주소와 OSM 경계를 대조한 보관본입니다. 꽃은 단지 중심을 표시합니다.'),
)
sel('element').onchange = () => {
  selected = sel('element').value
  fields()
}
field('maponly').onchange = () => {
  el('paper').replaceChildren(render(current, field('maponly').checked, true))
}
hook('apply', async () => {
  const p = structuredClone(current),
    i = p.spec.items.find((i) => i.id === selected)
  if (!i || i.kind === 'line') return
  const x = field('x').valueAsNumber,
    y = field('y').valueAsNumber
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1400 || y < 0 || y > 1440)
    throw Error('X는 0~1400, Y는 0~1440 범위로 입력해 주세요.')
  const before = JSON.stringify(i)
  i.x = x
  i.y = y
  i.hidden = !field('visible').checked
  if (i.kind === 'text') i.text = normalize(field('caption').value)
  if (JSON.stringify(i) !== before && !i.footer) p.review = pending()
  p.spec.ink = field('ink').value
  await modify(p)
})
let drag: { id: string; px: number; py: number } | undefined
const paper = el('paper')
paper.onpointerdown = (e) => {
  if (busy) return
  const target = (e.target as Element).closest('[data-item]'),
    id = target?.getAttribute('data-item')
  if (!id || !editable().some((i) => i.id === id)) return
  selected = id
  fields()
  drag = { id, px: e.clientX, py: e.clientY }
  paper.setPointerCapture(e.pointerId)
}
paper.onpointercancel = () => {
  drag = undefined
}
paper.onpointerup = (e) => {
  if (!drag || busy) return
  const { id, px, py } = drag
  drag = undefined
  if (Math.hypot(e.clientX - px, e.clientY - py) < 3) return
  const svg = paper.querySelector('svg')!,
    matrix = svg.getScreenCTM()?.inverse()
  if (!matrix) return
  const a = new DOMPoint(px, py).matrixTransform(matrix),
    b = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix)
  void action(async () => {
    const p = structuredClone(current),
      i = p.spec.items.find((i) => i.id === id)!
    if (i.kind === 'line') return
    i.x = Math.round(Math.min(1400, Math.max(0, i.x + b.x - a.x)))
    i.y = Math.round(Math.min(1440, Math.max(0, i.y + b.y - a.y)))
    if (!i.footer) p.review = pending()
    await modify(p)
  })()
}
hook('undo', async () => {
  const previous = history.pop()
  if (previous) {
    current = previous
    paint()
    await save(current)
    await library()
    status('직전 편집을 취소했습니다.')
  }
})
el('review-panel').addEventListener('input', () => status('', false, 'review-status'))
el('review-map').addEventListener('click', () => {
  const source = field('review-source')
  if (!source.value.trim()) {
    source.value = el<HTMLAnchorElement>('review-map').href
    status('열어 본 네이버 지도 링크를 입력했습니다.', false, 'review-status')
  }
})
el('review').addEventListener('click', action(async () => {
  const note = field('review-note').value.trim()
  const source = field('review-source').value.trim()
  const url = URL.canParse(source) ? new URL(source) : null
  const missing = el('review-checks').querySelectorAll('input:not(:checked)').length
  const errors: string[] = []
  if (!note) errors.push('대조 방법과 관찰 내용을 입력해 주세요.')
  if (!source) errors.push('직접 대조한 네이버 지도 링크를 입력해 주세요.')
  else if (!url || url.protocol !== 'https:' || !['map.naver.com', 'm.map.naver.com', 'naver.me'].includes(url.hostname))
    errors.push('네이버 지도의 장소 링크나 공유 링크(naver.me)를 입력해 주세요.')
  if (missing) errors.push(`대조 항목 ${missing}개가 체크되지 않았습니다.`)
  if (errors.length || !url) throw Error(errors.join(' '))
  const p = structuredClone(current)
  p.review = {
    status: 'checked',
    verifiedAt: iso(),
    note,
    evidence: { url: url.href, method: 'naver_map_visual', checks: verifiedChecks },
  }
  await modify(p)
}, 'review'))
hook('backup', async () => {
  link(
    new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }),
    'WeddingMap_Project.json',
    el('downloads'),
    '프로젝트 JSON',
  ).click()
})
el('import-btn').onclick = () => field('import').click()
field('import').onchange = () => {
  const file = field('import').files?.[0]
  field('import').value = ''
  if (file)
    void action(async () => {
      if (file.size > 5 * 1024 * 1024) throw Error('5 MiB 이하의 프로젝트만 열 수 있습니다.')
      await use(
        importProject(await file.text()),
        'JSON을 복원했습니다. 위치 검수와 최신성은 다시 확인해 주세요.',
      )
    })()
}
hook('erase', async () => {
  if (confirm('이 브라우저의 프로젝트, 받은 지도와 보관 ZIP을 모두 삭제할까요?')) {
    backgroundRoads?.abort()
    await erase()
    location.reload()
  }
})
hook('download', async (signal) => {
  clearFiles()
  const target = el('downloads')
  target.className = 'downloads'
  const key = await fileKey(current),
    existing = await readArchive(key)
  signal.throwIfAborted()
  if (existing) {
    link(existing.zip, existing.name, target, '보관 ZIP 다운로드').click()
    status('파일 무결성을 확인하고 기존 ZIP을 불러왔습니다.')
    return
  }
  const { exportMap } = await import('./export')
  const readme = [
    current.name,
    current.address,
    '오시는 길 · 청첩장 약도',
    '전체 140 × 144 mm, 지도만 140 × 114 mm. PNG 600 dpi, 인쇄용 벡터 PDF 1쪽.',
    '편집용 SVG 글꼴: Noto Serif CJK KR / Noto Sans CJK KR. 글꼴이 없는 기기에서는 윤곽선 SVG를 사용하세요.',
    el('meta').textContent,
    current.origin === 'osm'
      ? '약도 그림을 청첩장에 배치할 때 지도 출처를 함께 표시하세요. 인쇄물은 약도 옆이나 출처란에 “지도 데이터 © OpenStreetMap contributors · openstreetmap.org/copyright”를 넣고, 웹에서는 “지도 데이터 © OpenStreetMap”에 https://www.openstreetmap.org/copyright 링크를 연결하세요.'
      : '',
  ].filter(Boolean).join('\n')
  const verification = [
    current.origin === 'osm'
      ? 'OpenStreetMap contributors · ODbL 1.0 · https://www.openstreetmap.org/copyright'
      : '다산20 첨부 자료의 기존 배치 재현',
    current.geo
      ? '목적지 객체 ' + current.geo.place.id + ' / ' + current.geo.place.entrance
      : '첨부 원본 검수일 2026-11-14',
    current.geo ? 'WGS84 · OSM 도로 ' + current.geo.roads.length + '개' : '',
    '조회 ' + date(current.lastSuccessfulFetchAt),
    el('location-result').textContent,
    localLocationCheck(current)?.source,
    '사용자 대조 ' + date(current.review.verifiedAt),
    current.review.note,
    current.review.evidence ? JSON.stringify(current.review.evidence) : '',
    '보행·차량 입구 미확인',
    current.refreshFailed ? '이전 조회본 · 갱신 실패' : '',
  ]
    .filter(Boolean)
    .join('\n')
  const result = await exportMap(
    {
      fullSvg: serialize(current),
      mapOnlySvg: serialize(current, true),
      basename: current.name,
      readme,
      verification,
    },
    { signal, onProgress: (_n, d, t) => status(`인쇄 파일 생성 중 · ${d}/${t}`) },
  )
  link(result.zip, result.zipName, target, '전체 ZIP 다운로드')
  for (const [name, blob] of result.files)
    link(blob, name, target, name.slice(name.indexOf('_') + 1))
  try {
    await archive(key, current.id, result.zipName, result.zip)
    await library()
    status('10개 파일을 생성하고 ZIP을 이 기기에 보관했습니다.')
  } catch {
    status('파일을 생성했습니다. 기기 저장 공간이 부족하면 지금 ZIP을 다운로드해 주세요.', true)
  }
})
hook('print-preview', async (signal) => {
  const { exportPreview } = await import('./export')
  const blob = await exportPreview(serialize(current), signal)
  clearFiles()
  const a = link(blob, 'WeddingMap_Preview.png', el('downloads'), '150 dpi 미리보기 저장')
  const img = new Image()
  img.src = a.href
  img.alt = '인쇄용 글자 윤곽선을 적용한 약도'
  img.style.width = '100%'
  el('downloads').append(img)
  status('150 dpi 인쇄 미리보기를 생성했습니다.')
})
const naverKey = import.meta.env.VITE_NAVER_PUBLIC_KEY
el('naver').hidden = !naverKey
el('naver-notice').hidden = !naverKey
async function checkWithNaver() {
  const container = el('naver-map')
  try {
    await showNaver(container, current.address, naverKey, markerPoint(current))
  } catch (error) {
    container.textContent = error instanceof Error ? error.message : '네이버 위치 대조에 실패했습니다.'
  }
}
hook('naver', checkWithNaver)
el('relock').onclick = () => {
  backgroundRoads?.abort()
  busy?.abort()
  location.reload()
}
if (canSetup()) {
  el('password-label').textContent = '이 기기에서 사용할 전용 암호 (12자 이상)'
  el('enter').textContent = '암호 설정하고 열기'
  field('password').autocomplete = 'new-password'
}
el('unlock').onsubmit = async (e) => {
  e.preventDefault()
  const btn = el<HTMLButtonElement>('enter')
  btn.disabled = true
  try {
    const input = field('password'),
      value = input.value
    input.value = ''
    await unlock(value)
    await seedGeography(knownGeo, fixture.fetchedAt)
    const list = (await projects()).sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt))
    await use(
      list[0] ?? sample74(),
      list.length
        ? '최근 프로젝트를 열었습니다.'
        : '다산74 보관본 · 단지 중심을 기준으로 생성한 약도입니다.',
    )
    el('gate').hidden = true
    el('studio').hidden = false
  } catch (e) {
    el('gate-error').textContent = e instanceof Error ? e.message : '작업실을 열 수 없습니다.'
  } finally {
    btn.disabled = false
  }
}

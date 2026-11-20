import {
  DAY,
  digest,
  fresh,
  iso,
  placeKey,
  type Geography,
  type Place,
  type Project,
} from './model'
type Bucket = 'geo' | 'projects' | 'files'
let connection: Promise<IDBDatabase> | undefined
function db() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('wedding-map-studio', 1)
    req.onupgradeneeded = () => {
      for (const n of ['geo', 'projects', 'files']) req.result.createObjectStore(n)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      connection = undefined
      reject(req.error)
    }
  }))
}
async function run<T>(
  bucket: Bucket,
  mode: IDBTransactionMode,
  task: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const tx = (await db()).transaction(bucket, mode),
    request = task(tx.objectStore(bucket))
  return new Promise((res, rej) => {
    tx.oncomplete = () => res(request.result)
    tx.onabort = tx.onerror = () => rej(tx.error ?? Error('기기 저장소를 사용할 수 없습니다.'))
  })
}
const get = <T>(b: Bucket, k: string) => run<T | undefined>(b, 'readonly', (s) => s.get(k))
const put = (b: Bucket, k: string, v: unknown) => run(b, 'readwrite', (s) => s.put(v, k))
export const projects = () => run<Project[]>('projects', 'readonly', (s) => s.getAll())
export const save = (p: Project) => put('projects', p.id, p)
export const drop = (id: string) => run('projects', 'readwrite', (s) => s.delete(id))
export async function erase() {
  const tx = (await db()).transaction(['projects', 'files', 'geo'], 'readwrite')
  for (const b of ['projects', 'files', 'geo']) tx.objectStore(b).clear()
  await new Promise<void>((ok, no) => {
    tx.oncomplete = () => ok()
    tx.onabort = () => no(tx.error)
  })
}
export interface Snapshot {
  geo: Geography
  hash: string
  lastSuccessfulFetchAt: string
  expiresAt: string
  lastAccessedAt: string
  imported: false
}
export const snapshots = () => run<Snapshot[]>('geo', 'readonly', (s) => s.getAll())
export type FetchOutcome = {
  snap: Snapshot
  state: 'reused' | 'refreshed' | 'failed'
  error?: string
}
export async function resolveSnapshot(
  previous: Snapshot | undefined,
  force: boolean,
  fetcher: () => Promise<Geography>,
  now = Date.now,
): Promise<FetchOutcome> {
  if (previous && !force && fresh(previous, now()))
    return { snap: { ...previous, lastAccessedAt: iso(now()) }, state: 'reused' }
  try {
    const geo = await fetcher()
    const hash = await digest(JSON.stringify(geo)),
      end = now()
    return {
      snap: {
        geo,
        hash,
        lastSuccessfulFetchAt: iso(end),
        lastAccessedAt: iso(end),
        expiresAt: iso(end + DAY),
        imported: false,
      },
      state: 'refreshed',
    }
  } catch (e) {
    if (!previous || (e instanceof DOMException && e.name === 'AbortError')) throw e
    return {
      snap: previous,
      state: 'failed',
      error: e instanceof Error ? e.message : '지도 조회 실패',
    }
  }
}
export async function seedGeography(geo: Geography, fetchedAt: string) {
  const key = placeKey(geo.place)
  const snap: Snapshot = {
    geo, hash: await digest(JSON.stringify(geo)), lastSuccessfulFetchAt: fetchedAt,
    lastAccessedAt: fetchedAt, expiresAt: iso(Date.parse(fetchedAt) + DAY), imported: false,
  }
  // Seed independently of slow provider requests in other tabs. The comparison
  // and write share one transaction so an older extract cannot replace a refresh.
  const tx = (await db()).transaction('geo', 'readwrite')
  const store = tx.objectStore('geo')
  const request = store.get(key)
  request.onsuccess = () => {
    const prior = request.result as Snapshot | undefined
    if (!prior || prior.lastSuccessfulFetchAt < fetchedAt ||
        (prior.lastSuccessfulFetchAt === fetchedAt && prior.hash !== snap.hash)) store.put(snap, key)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error ?? Error('도로 자료를 저장할 수 없습니다.'))
  })
}
export const savedGeography = (place: Place) => get<Snapshot>('geo', placeKey(place))
const pending = new Map<string, Promise<FetchOutcome>>()
export function resolvePlace(
  place: Place,
  force: boolean,
  fetcher: () => Promise<Geography>,
  signal?: AbortSignal,
) {
  const key = placeKey(place)
  if (pending.has(key)) return pending.get(key)!
  const operation = (async () => {
    const before = await get<Snapshot>('geo', key)
    // Serialize network and commit across tabs. Coalesce a refresh already finished by another tab.
    return navigator.locks.request('wedding-map-provider', { signal }, async () => {
      const previous = await get<Snapshot>('geo', key)
      const result = await resolveSnapshot(
        previous,
        force && before?.lastSuccessfulFetchAt === previous?.lastSuccessfulFetchAt,
        fetcher,
      )
      signal?.throwIfAborted()
      if (result.state !== 'failed') await put('geo', key, result.snap)
      return result
    })
  })().finally(() => pending.delete(key))
  pending.set(key, operation)
  return operation
}
export interface Archive {
  key: string
  projectId: string
  name: string
  createdAt: string
  zip: Blob
  hash: string
}
export async function fileKey(project: Project) {
  return digest(
    JSON.stringify([
      'export-v1',
      __RENDER_BUILD__,
      project.id,
      project.refreshFailed ?? false,
      project.name,
      project.address,
      project.origin,
      project.geo,
      project.spec,
      project.review,
      project.lastSuccessfulFetchAt,
      project.imported,
    ]),
  )
}
declare const __RENDER_BUILD__: string
export async function readArchive(key: string) {
  const a = await get<Archive>('files', key)
  return a && a.hash === (await digest(await a.zip.arrayBuffer())) ? a : undefined
}
export const archiveList = (id: string) =>
  run<Archive[]>('files', 'readonly', (s) => s.getAll()).then((rows) =>
    rows.filter((a) => a.projectId === id),
  )
export async function archive(key: string, projectId: string, name: string, zip: Blob) {
  const value: Archive = {
    key,
    projectId,
    name,
    zip,
    hash: await digest(await zip.arrayBuffer()),
    createdAt: iso(),
  }
  await put('files', key, value)
  return value
}

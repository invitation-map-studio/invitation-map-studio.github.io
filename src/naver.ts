import { compareNaverAddress } from './location-check'
import type { Point } from './model'
interface AddressResult {
  roadAddress?: string
  jibunAddress?: string
  x?: string
  y?: string
}
interface MapInstance {
  destroy(): void
}
interface NaverMaps {
  LatLng: new (latitude: number, longitude: number) => object
  Map: new (area: HTMLElement, options: { center: object; zoom: number }) => MapInstance
  Marker: new (options: { position: object; map: MapInstance }) => { setMap(map: null): void }
  Service: {
    Status: { OK: unknown }
    geocode(
      options: { query: string },
      cb: (
        status: unknown,
        data?: {
          v2?: { status?: string; addresses?: AddressResult[] }
        },
      ) => void,
    ): void
  }
}
interface MapWindow extends Window {
  naver?: { maps?: NaverMaps }
  onWeddingMapSdkReady?: () => void
  navermap_authFailure?: () => void
}

const host = () => window as MapWindow
const authError = () =>
  new Error(
    '네이버 지도 인증을 확인해 주세요. 등록 도메인·공개 키·API 한도를 확인한 후 새로고침해 주세요.',
  )
let sdkLoad: Promise<NaverMaps> | undefined
let loadedKey = ''
let view:
  | { container: HTMLElement; requestId: string; controller: AbortController; disposeMap?: () => void }
  | undefined

function loadSdk(key: string): Promise<NaverMaps> {
  if (sdkLoad) {
    if (loadedKey !== key) throw new Error('지도를 다른 공개 키로 열려면 새로고침해 주세요.')
    return sdkLoad
  }
  loadedKey = key
  sdkLoad = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const timer = window.setTimeout(() => {
      reject(
        new Error('네이버 지도 SDK 응답이 지연되었습니다. 연결을 확인한 후 새로고침해 주세요.'),
      )
    }, 15000)
    host().onWeddingMapSdkReady = () => {
      window.clearTimeout(timer)
      const maps = host().naver?.maps
      if (maps?.Service?.geocode) resolve(maps)
      else reject(new Error('네이버 주소 검색 모듈을 열 수 없습니다.'))
    }
    host().navermap_authFailure = () => {
      window.clearTimeout(timer)
      const error = authError()
      if (view) {
        const { container } = view
        closeNaver(container)
        container.textContent = error.message
      }
      reject(error)
    }
    script.onerror = () => {
      window.clearTimeout(timer)
      reject(
        new Error(
          '네이버 지도 SDK를 읽을 수 없습니다. 연결과 배포 설정을 확인한 후 새로고침해 주세요.',
        ),
      )
    }
    const url = new URL('https://oapi.map.naver.com/openapi/v3/maps.js')
    url.searchParams.set('ncpKeyId', key)
    url.searchParams.set('submodules', 'geocoder')
    url.searchParams.set('callback', 'onWeddingMapSdkReady')
    script.src = url.href
    script.referrerPolicy = 'strict-origin-when-cross-origin'
    script.async = true
    document.head.append(script)
  })
  return sdkLoad
}

function geocode(maps: NaverMaps, query: string, signal: AbortSignal): Promise<AddressResult[]> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      reject(new Error('네이버 주소 검색 응답 시간이 초과되었습니다.'))
    }, 15000)
    signal.addEventListener('abort', onAbort, { once: true })
    maps.Service.geocode({ query }, (status, data) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      const result = data?.v2
      if (
        status !== maps.Service.Status.OK ||
        result?.status !== 'OK' ||
        !Array.isArray(result.addresses)
      ) {
        reject(new Error('네이버 주소 검색에 실패했습니다. API 설정과 이용 한도를 확인해 주세요.'))
      } else if (result.addresses.length === 0) {
        reject(new Error('좌표를 찾지 못했습니다. 시·군·구와 건물번호를 확인해 주세요.'))
      } else {
        resolve(result.addresses)
      }
    })
  })
}

export function closeNaver(container: HTMLElement): void {
  if (view?.container !== container) return
  view.controller.abort()
  view.disposeMap?.()
  view = undefined
  container.replaceChildren()
}

export async function showNaver(
  container: HTMLElement,
  address: string,
  publicKey: string,
  markerPoint?: Point,
): Promise<void> {
  const key = publicKey.trim()
  const query = address.trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new Error('네이버 지도 공개 키 설정이 필요합니다.')
  if (!query || query.length > 200)
    throw new Error('실시간으로 확인할 주소를 200자 이내로 입력해 주세요.')
  const requestId = JSON.stringify([key, query, markerPoint])
  if (view?.container === container && view.requestId === requestId) return
  if (view) closeNaver(view.container)
  const controller = new AbortController()
  const current: NonNullable<typeof view> = { container, controller, requestId }
  view = current
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '실시간 확인 닫기'
  close.onclick = () => closeNaver(container)
  const info = document.createElement('p')
  info.setAttribute('role', 'status')
  info.textContent = '네이버 지도에서 주소를 조회하고 있습니다.'
  container.replaceChildren(close, info)
  try {
    const maps = await loadSdk(key)
    if (controller.signal.aborted || !container.isConnected) return
    const matches = await geocode(maps, query, controller.signal)
    if (controller.signal.aborted || !container.isConnected) return
    const choices = document.createElement('div')
    const area = document.createElement('div')
    area.style.height = '320px'
    area.setAttribute('aria-label', '네이버 주소 확인 지도')
    function display(item: AddressResult) {
      if (controller.signal.aborted || !container.isConnected) return
      current.disposeMap?.()
      const point = new maps.LatLng(Number(item.y), Number(item.x))
      area.hidden = false
      const map = new maps.Map(area, { center: point, zoom: 17 })
      const marker = new maps.Marker({ position: point, map })
      current.disposeMap = () => {
        marker.setMap(null)
        map.destroy()
      }
      const comparison = markerPoint
        ? compareNaverAddress(address, item.roadAddress ?? '', [Number(item.x), Number(item.y)], markerPoint)
        : '꽃 표식 좌표 확인 필요'
      info.textContent = `네이버 위치 대조 · ${comparison}. 출입구는 별도 확인이 필요합니다.`
    }
    for (const item of matches) {
      const lon = Number(item?.x)
      const lat = Number(item?.y)
      if (
        !item?.x ||
        !item?.y ||
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        lon < 124 ||
        lon > 132 ||
        lat < 33 ||
        lat > 39 ||
        !(item.roadAddress || item.jibunAddress)
      ) {
        throw new Error('주소 또는 좌표를 확인할 수 없습니다.')
      }
    }
    area.hidden = true
    container.append(choices, area)
    if (matches.length === 1) display(matches[0])
    else {
      info.textContent = '확인할 주소 후보를 선택해 주세요.'
      for (const item of matches) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = item.roadAddress || item.jibunAddress || ''
        button.onclick = () => display(item)
        choices.append(button)
      }
    }
  } catch (error) {
    if (controller.signal.aborted) return
    closeNaver(container)
    throw error
  }
}

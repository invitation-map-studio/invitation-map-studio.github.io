import { zipSync, type Zippable } from 'fflate'
import { outlineText } from './fonts'

export interface ExportInput {
  fullSvg: string
  mapOnlySvg: string
  basename: string
  readme: string
  verification: string
}

export interface ExportOptions {
  signal?: AbortSignal
  onProgress?: (filename: string, done: number, total: number) => void
}

const ns = 'http://www.w3.org/2000/svg'
const ivory = '#fbf9f5'
const serialize = (svg: SVGSVGElement) => new XMLSerializer().serializeToString(svg)

export function fileBasename(name: string): string {
  const safe = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '_')
    .replace(/^[.\s]+|[.\s]+$/gu, '').slice(0, 64)
  return safe || 'Wedding'
}

function parseMap(source: string, height: number): SVGSVGElement {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = doc.documentElement
  if (root.localName !== 'svg' || root.namespaceURI !== ns || doc.doctype ||
      root.getAttribute('viewBox')?.trim().replace(/\s+/g, ' ') !== `0 0 1400 ${height}`) {
    throw new Error('약도의 SVG 규격을 확인해 주세요.')
  }
  // Export opens only SVG from the app renderer. Project imports never accept SVG markup.
  const elements = new Set(['svg', 'title', 'desc', 'g', 'path', 'polyline', 'line', 'polygon', 'text', 'rect', 'circle', 'ellipse', 'defs', 'clipPath', 'use'])
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el.namespaceURI !== ns || !elements.has(el.localName)) throw new Error('지원하지 않는 SVG 요소입니다.')
    for (const attr of el.attributes) {
      if (attr.localName.startsWith('on') || ['style', 'base'].includes(attr.localName) ||
        (attr.localName === 'href' && !/^#[\w.-]+$/.test(attr.value)) ||
        (/url\(/i.test(attr.value) && !/^url\(#[\w.-]+\)$/.test(attr.value))) {
        throw new Error('외부 자원을 사용하는 SVG 속성이 있습니다.')
      }
    }
  }
  root.setAttribute('width', '140mm')
  root.setAttribute('height', `${height / 10}mm`)
  return root as unknown as SVGSVGElement
}

async function outlined(svg: SVGSVGElement, signal?: AbortSignal): Promise<SVGSVGElement> {
  const copy = svg.cloneNode(true) as SVGSVGElement
  let pathLength = 0
  let lastYield = performance.now()
  for (const label of copy.querySelectorAll('text')) {
    signal?.throwIfAborted()
    function attr(name: string, fallback: string) {
      return label.closest(`[${name}]`)?.getAttribute(name) ?? fallback
    }
    const path = copy.ownerDocument.createElementNS(ns, 'path')
    const text = label.textContent ?? ''
    const d = await outlineText({text, family: attr('font-family', 'Noto Serif CJK KR'),
      weight: attr('font-weight', '400'), size: Number(attr('font-size', '30')),
      x: Number(label.getAttribute('x') || 0), y: Number(label.getAttribute('y') || 0),
      anchor: attr('text-anchor', 'start'), letterSpacing: Number(attr('letter-spacing', '0'))})
    pathLength += d.length
    if (pathLength > 8 * 1024 * 1024) throw new Error('글자 윤곽선이 8 MiB를 초과합니다. 표시할 문구 수를 줄여 주세요.')
    if (performance.now() - lastYield > 32) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      signal?.throwIfAborted()
      lastYield = performance.now()
    }
    path.setAttribute('d', d)
    path.setAttribute('aria-label', text)
    for (const key of ['fill', 'stroke', 'opacity', 'transform', 'id', 'clip-path', 'display', 'visibility']) {
      if (label.hasAttribute(key)) path.setAttribute(key, label.getAttribute(key)!)
    }
    label.replaceWith(path)
  }
  signal?.throwIfAborted()
  return copy
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// Browsers usually write 96 dpi. Replace the density chunk without recompressing the pixels.
export async function setPngDensity(png: Blob, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await png.arrayBuffer())
  const view = new DataView(bytes.buffer)
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(12) !== 0x49484452) throw new Error('PNG 헤더 오류')
  const density = new Uint8Array(21)
  const meta = new DataView(density.buffer)
  meta.setUint32(0, 9)
  density.set([112, 72, 89, 115], 4) // pHYs
  meta.setUint32(8, Math.round(dpi / 0.0254))
  meta.setUint32(12, Math.round(dpi / 0.0254))
  density[16] = 1
  meta.setUint32(17, crc32(density.subarray(4, 17)))
  const chunks: BlobPart[] = [png.slice(0, 8)]
  let end = false
  for (let pos = 8; pos < bytes.length;) {
    const size = view.getUint32(pos) + 12
    const type = view.getUint32(pos + 4)
    if (pos + size > bytes.length) throw new Error('PNG 청크 오류')
    if (type !== 0x70485973) chunks.push(png.slice(pos, pos + size))
    if (type === 0x49484452) chunks.push(density)
    end = type === 0x49454e44
    pos += size
  }
  if (!end) throw new Error('PNG 종료 청크 오류')
  return new Blob(chunks, {type:'image/png'})
}

async function pngImage(svg: SVGSVGElement, height: number, dpi: number, background: string | null, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(140 / 25.4 * dpi)
  canvas.height = Math.round(height / 25.4 * dpi)
  const imageSvg = svg.cloneNode(true) as SVGSVGElement
  imageSvg.setAttribute('width', String(canvas.width))
  imageSvg.setAttribute('height', String(canvas.height))
  const url = URL.createObjectURL(new Blob([serialize(imageSvg)], {type: 'image/svg+xml'}))
  const img = new Image()
  try {
    img.src = url
    await img.decode()
    signal?.throwIfAborted()
    const context = canvas.getContext('2d')
    if (!context) throw new Error('이미지를 만들 메모리가 부족합니다.')
    if (background) {
      context.fillStyle = background
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.drawImage(img, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(image => image ? resolve(image) : reject(new Error('PNG 생성에 실패했습니다.')), 'image/png'))
    signal?.throwIfAborted()
    return await setPngDensity(blob, dpi)
  } finally {
    canvas.width = canvas.height = 1
    img.removeAttribute('src')
    URL.revokeObjectURL(url)
  }
}

async function printPdf(svg: SVGSVGElement, signal?: AbortSignal) {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  signal?.throwIfAborted()
  const pdf = new jsPDF({unit: 'mm', format: [140, 144], compress: true, putOnlyUsedFonts: true, floatPrecision: 6})
  pdf.setCreationDate("D:20000101000000+00'00'")
  const sourceHash = await sha256(new Blob([serialize(svg)]))
  pdf.setFileId(sourceHash.slice(0, 32))
  pdf.setFillColor(255, 255, 255)
  pdf.rect(0, 0, 140, 144, 'F')
  const root = svg.cloneNode(true) as SVGSVGElement
  root.setAttribute('width', '140')
  root.setAttribute('height', '144')
  await svg2pdf(root, pdf, {x: 0, y: 0, width: 140, height: 144, loadExternalStyleSheets: false, loadImages: false})
  signal?.throwIfAborted()
  return pdf.output('blob')
}

export async function sha256(blob: Blob): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function exportPreview(fullSvg: string, signal?: AbortSignal): Promise<Blob> {
  return pngImage(await outlined(parseMap(fullSvg, 1440), signal), 144, 150, ivory, signal)
}

export async function exportMap(input: ExportInput, {signal, onProgress}: ExportOptions = {}) {
  signal?.throwIfAborted()
  const basename = fileBasename(input.basename)
  const editable = parseMap(input.fullSvg, 1440)
  const full = await outlined(editable, signal)
  const map = await outlined(parseMap(input.mapOnlySvg, 1140), signal)
  const files = new Map<string, Blob>()
  const hashes: Record<string, string> = {}
  const archive: Zippable = {}
  async function add(suffix: string, blob: Blob) {
    signal?.throwIfAborted()
    const filename = basename + suffix
    const bytes = new Uint8Array(await blob.arrayBuffer())
    files.set(filename, blob)
    hashes[filename] = await sha256(blob)
    archive[filename] = [bytes, {level: /\.(png|pdf)$/.test(filename) ? 0 : 6}]
    onProgress?.(filename, files.size, 10)
  }
  const svgBlob = (svg: SVGSVGElement) => new Blob([serialize(svg)], {type: 'image/svg+xml;charset=utf-8'})
  await add('_Map.svg', svgBlob(full))
  await add('_Map_Editable.svg', svgBlob(editable))
  await add('_MapOnly.svg', svgBlob(map))
  await add('_Map.png', await pngImage(full, 144, 600, ivory, signal))
  await add('_Map_White.png', await pngImage(full, 144, 600, '#ffffff', signal))
  await add('_Map_Transparent.png', await pngImage(full, 144, 600, null, signal))
  await add('_MapOnly_Transparent.png', await pngImage(map, 114, 600, null, signal))
  await add('_Map_Print.pdf', await printPdf(full, signal))
  const text = (value: string) => new Blob([value], {type: 'text/plain;charset=utf-8'})
  await add('_Readme_KO.txt', text(input.readme))
  await add('_Verification.txt', text(input.verification))
  signal?.throwIfAborted()
  const zipped = zipSync(archive, {mtime: new Date(2000, 0, 1)})
  const zip = new Blob([new Uint8Array(zipped)], {type: 'application/zip'})
  return { files, zip, hashes, zipName: basename + '_Files.zip' }
}

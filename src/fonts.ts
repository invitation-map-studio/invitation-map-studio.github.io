import { gunzipSync, strFromU8 } from "fflate";

export const FONT_EDITION = "noto-cjk-2.003-2.004-v1";

export interface OutlineInput {
  text: string;
  family: string;
  weight: string | number;
  size: number;
  x: number;
  y: number;
  anchor?: string;
  letterSpacing?: number;
}

type Face = "serif" | "bold" | "sans";
type Glyph = [advance: number, segments: (number | string)[]];
type Shard = Record<string, Glyph>;
const cache = new Map<string, Shard>();
const pending = new Map<string, Promise<Shard>>();
const MAX_CACHED_SHARDS = 12;

function fontFace(family: string, weight: string | number): Face {
  const name = family.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
  const bold = weight === "bold" || Number(weight) === 700;
  const regular = weight === "normal" || Number(weight) === 400;
  if (name === "noto serif cjk kr" || name === "serif") {
    if (regular) return "serif";
    if (bold) return "bold";
  }
  if ((name === "noto sans cjk kr" || name === "sans-serif") && regular) return "sans";
  throw new Error(`지원하지 않는 글꼴 또는 굵기입니다. ${family} (${weight})`);
}

async function loadShard(key: string): Promise<Shard> {
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const loading = pending.get(key);
  if (loading) return loading;
  const request = (async () => {
    const url = new URL(`fonts/${FONT_EDITION}/${key}.bin`, document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error("글꼴 파일을 읽을 수 없습니다. 연결을 확인해 주세요.");
    const data: Shard = JSON.parse(strFromU8(gunzipSync(new Uint8Array(await response.arrayBuffer()))));
    cache.set(key, data);
    if (cache.size > MAX_CACHED_SHARDS) cache.delete(cache.keys().next().value!);
    return data;
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}

// Skip network requests for unsupported Unicode blocks, including emoji.
function hasShard(block: number): boolean {
  return block <= 1 || [0x11, 0x20, 0x21, 0x30, 0x31, 0xFF].includes(block)
    || (block >= 0x4E && block <= 0x9F) || (block >= 0xAC && block <= 0xD7)
    || block === 0xF9 || block === 0xFA;
}

async function getGlyph(char: string, face: Face): Promise<Glyph> {
  const code = char.codePointAt(0)!;
  const block = code >>> 8;
  if (hasShard(block)) {
    const shard = await loadShard(`${face}/${block.toString(16)}`);
    const glyph = shard[code & 0xff];
    if (glyph) return glyph;
  }
  throw new Error(`지원하지 않는 글자입니다. ${char} (U+${code.toString(16).toUpperCase()})`);
}

const round = (value: number) => String(Number(value.toFixed(5)));

function placeGlyph(glyph: Glyph, originX: number, baselineY: number, scale: number): string {
  const output: string[] = [];
  let xCoordinate = true;
  for (const token of glyph[1]) {
    if (typeof token === "string") {
      output.push(token);
      xCoordinate = true;
    } else {
      output.push(round(xCoordinate ? originX + token * scale : baselineY - token * scale));
      xCoordinate = !xCoordinate;
    }
  }
  return output.join(" ");
}

/** Convert one unrotated line to absolute SVG path data in the caller's user units. */
export async function outlineText(input: OutlineInput): Promise<string> {
  const { text, family, weight, size, x, y, anchor = "start", letterSpacing = 0 } = input;
  if (![x, y, size, letterSpacing].every(Number.isFinite) || size <= 0) {
    throw new Error("글자 크기와 위치를 확인해 주세요.");
  }
  if (!["start", "middle", "end"].includes(anchor)) throw new Error("글자 정렬을 확인해 주세요.");
  const chars = Array.from(text.normalize("NFC"));
  const face = fontFace(family, weight);
  const glyphs = await Promise.all(chars.map(char => getGlyph(char, face)));
  const scale = size / 1000;
  const width = glyphs.reduce((sum, [advance]) => sum + advance * scale, 0)
    + Math.max(0, chars.length - 1) * letterSpacing;
  let cursor = x - (anchor === "middle" ? width / 2 : anchor === "end" ? width : 0);
  return glyphs.map(glyph => {
    const path = placeGlyph(glyph, cursor, y, scale);
    cursor += glyph[0] * scale + letterSpacing;
    return path;
  }).join(" ");
}

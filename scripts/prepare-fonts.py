"""Build versioned static outline shards from the official Noto CJK Korean OTFs."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import urllib.request

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont

BASE = "https://raw.githubusercontent.com/notofonts/noto-cjk"
EDITION = "noto-cjk-2.003-2.004-v1"
FONTS = {
    "serif": ("Serif", "Regular", "2.003", "77b4b741f864d27f15e90f275b17106dde90b2ad28f82bab72dc95805db5fb42"),
    "bold": ("Serif", "Bold", "2.003", "10cc03741178ad6d2747df8497d911e34b167d0474a826fb9d866c402cbe3d8f"),
    "sans": ("Sans", "Regular", "2.004", "6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a"),
}
OFL_SHA = "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2"


def get_source(cache, filename, url, sha):
    target = cache / filename
    if not target.exists():
        with urllib.request.urlopen(url, timeout=60) as response:
            target.write_bytes(response.read())
    if hashlib.sha256(target.read_bytes()).hexdigest() != sha:
        raise ValueError(f"Unexpected SHA-256 for {filename}")
    return target


class OutlinePen(BasePen):
    """Coordinates in unscaled font units, with one explicit opcode per segment."""

    def __init__(self, glyphs):
        super().__init__(glyphs)
        self.segments = []

    def add(self, opcode, *points):
        self.segments.append(opcode)
        for point in points:
            self.segments.extend(int(n) if n == int(n) else n for n in point)

    def _moveTo(self, p):
        self.add("M", p)

    def _lineTo(self, p):
        self.add("L", p)

    def _curveToOne(self, p, q, r):
        self.add("C", p, q, r)

    def _qCurveToOne(self, p, q):
        self.add("Q", p, q)

    def _closePath(self):
        self.add("Z")

    def _endPath(self):
        pass


def supported_codepoints():
    # ASCII/Latin, Hangul Jamo and syllables, common punctuation and fullwidth forms.
    ranges = [(0x20, 0x7E), (0xA0, 0x24F), (0x1100, 0x11FF), (0x2000, 0x206F),
              (0x20A0, 0x20CF), (0x2100, 0x219F), (0x3000, 0x303F),
              (0x3130, 0x318F), (0xAC00, 0xD7A3), (0xFF01, 0xFFEF)]
    points = {n for lo, hi in ranges for n in range(lo, hi + 1)}
    for high in range(0xCA, 0xFE):  # KS X 1001 Hanja
        for low in range(0xA1, 0xFF):
            word = bytes((high, low)).decode("euc_kr", errors="ignore")
            if len(word) == 1:
                points.add(ord(word))
    return sorted(points)


def build(cache, out):
    out.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    license_file = get_source(cache, "Serif-LICENSE", BASE + "/Serif2.003/Serif/LICENSE", OFL_SHA)
    (out / "OFL.txt").write_bytes(license_file.read_bytes())
    notices = []
    for face, (family, weight, version, sha) in FONTS.items():
        name = f"Noto{family}CJKkr-{weight}.otf"
        url = f"{BASE}/{family}{version}/{family}/OTF/Korean/{name}"
        font = TTFont(get_source(cache, name, url, sha))
        if font["head"].unitsPerEm != 1000:
            raise ValueError("Outline decoder requires 1000 units per em")
        glyphs = font.getGlyphSet()
        cmap = font.getBestCmap()
        if any(code not in cmap for code in range(0xAC00, 0xD7A4)):
            raise ValueError(f"Missing Hangul syllable in {name}")
        chunks = {}
        for code in supported_codepoints():
            if code not in cmap:
                continue
            glyph = glyphs[cmap[code]]
            pen = OutlinePen(glyphs)
            glyph.draw(pen)
            chunks.setdefault(code // 256, {})[code % 256] = [glyph.width, pen.segments]
        face_dir = out / EDITION / face
        face_dir.mkdir(parents=True, exist_ok=True)
        for shard, entries in chunks.items():
            encoded = json.dumps(entries, separators=(",", ":")).encode()
            # Explicitly fix gzip metadata for byte-identical rebuilds across hosts.
            with (face_dir / f"{shard:x}.bin").open("wb") as raw:
                with gzip.GzipFile(fileobj=raw, filename="", mode="wb", mtime=0, compresslevel=9) as stream:
                    stream.write(encoded)
        notices.append(f"{name}\n{font['name'].getDebugName(0)}\n{url}\nSHA-256 {sha}\n")
        print(f"{face}: {sum(map(len, chunks.values()))} characters, {len(chunks)} shards", flush=True)
    (out / "NOTICE.txt").write_text(
        "Outline and advance-width assets derived from these Korean fonts.\n\n"
        + "\n".join(notices) + "\nLicensed under the SIL Open Font License, Version 1.1. See OFL.txt.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", required=True, type=Path, help="Local directory for pinned input OTF files")
    parser.add_argument("--out", type=Path, default=Path("public/fonts"))
    options = parser.parse_args()
    build(options.cache, options.out)

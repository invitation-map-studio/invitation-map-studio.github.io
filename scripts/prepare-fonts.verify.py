"""Compare generated glyphs and placement to the supplied Dasan20 vector reference."""

import gzip
import json
import math
import re
from pathlib import Path
import xml.etree.ElementTree as ET

from fontTools.pens.recordingPen import RecordingPen
from fontTools.svgLib.path import parse_path

SVG = "{http://www.w3.org/2000/svg}"
DATA = Path("public/fonts/noto-cjk-2.003-2.004-v1")
SAMPLE = Path("reference/Dasan20_Wedding_Map_Files")


def compare():
    reference = ET.parse(SAMPLE / "Dasan20_Wedding_Map.svg").getroot()
    editable = ET.parse(SAMPLE / "Dasan20_Wedding_Map_Editable.svg").getroot()
    defs = {node.get("id"): node.get("d") for node in reference.find(SVG + "defs")}
    labels = [g for g in reference.iter(SVG + "g") if g.findall(SVG + "use")]
    texts = list(editable.iter(SVG + "text"))
    assert len(labels) == len(texts) and labels
    used_glyphs = set()
    copies = 0
    for group, text in zip(labels, texts):
        uses = group.findall(SVG + "use")
        content = text.text
        assert group.get("aria-label") == content and len(uses) == len(content)
        face = "sans" if "Sans" in text.get("font-family") else "serif"
        if text.get("font-weight") == "700":
            face = "bold"
        spacing = float(text.get("letter-spacing"))
        scale = float(text.get("font-size")) / 1000
        entries = []
        for char in content:
            cp = ord(char)
            chunk = DATA / face / f"{cp // 256:x}.bin"
            entries.append(json.loads(gzip.decompress(chunk.read_bytes()))[str(cp % 256)])
        width = sum(g[0] * scale for g in entries) + (len(entries) - 1) * spacing
        x = float(text.get("x"))
        if text.get("text-anchor") == "middle":
            x -= width / 2
        y = float(text.get("y"))
        for use, (advance, outline) in zip(uses, entries):
            ref = use.get("href")[1:]
            used_glyphs.add(ref)
            a, b = RecordingPen(), RecordingPen()
            parse_path(defs[ref] or "", a)
            parse_path(" ".join(map(str, outline)), b)
            assert a.value == b.value, f"{content}: outline mismatch in {ref}"
            x0, y0, sx, sy = map(float, re.findall(r"-?\d+(?:\.\d+)?", use.get("transform")))
            expected = [x, y, scale, -scale]
            assert all(math.isclose(m, n, abs_tol=0.00006) for m, n in zip([x0, y0, sx, sy], expected)), (content, x0, x)
            x += advance * scale + spacing
            copies += 1
    for directory in DATA.iterdir():
        codes = set()
        for shard in directory.glob("*.bin"):
            chunk = json.loads(gzip.decompress(shard.read_bytes()))
            codes.update(int(shard.stem, 16) * 256 + int(key) for key in chunk)
        assert all(cp in codes for cp in range(0xAC00, 0xD7A4))
    print(f"{len(labels)} labels, {copies} placements, {len(used_glyphs)} distinct glyphs match.")
    print("All 11,172 modern Hangul syllables present in all 3 faces.")


if __name__ == "__main__":
    compare()

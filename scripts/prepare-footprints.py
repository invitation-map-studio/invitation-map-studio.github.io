"""Tile Korean OSM building outlines for live address-to-building matching."""
import gzip
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import osmium

source, output = map(Path, sys.argv[1:])
output.mkdir(parents=True, exist_ok=True)
reader = osmium.FileProcessor(str(source)).with_locations('sparse_mem_array')
buildings = osmium.filter.KeyFilter('building')
reader.with_areas(buildings).with_filter(osmium.filter.EntityFilter(osmium.osm.AREA))
tiles = set()
with TemporaryDirectory() as tmp:
    for area in reader:
        if not area.tags.get('building') or area.tags.get('building') == 'no':
            continue
        for outer in area.outer_rings():
            rings = [outer, *area.inner_rings(outer)]
            shape = [[(round(n.lon * 100000), round(n.lat * 100000)) for n in ring] for ring in rings]
            xs, ys = zip(*shape[0])
            west, east, south, north = min(xs), max(xs), min(ys), max(ys)
            row = [('w' if area.from_way() else 'r') + str(area.orig_id()), west, south,
                   [[v for x, y in ring[:-1] for v in (x-west, y-south)] for ring in shape]]
            line = json.dumps(row, separators=(',', ':')) + '\n'
            for x in range(west * 8 // 100000, east * 8 // 100000 + 1):
                for y in range(south * 8 // 100000, north * 8 // 100000 + 1):
                    tile = f'{x}-{y}'
                    tiles.add(tile)
                    with (Path(tmp) / tile).open('a') as f:
                        f.write(line)
    for tile in tiles:
        payload = (Path(tmp) / tile).read_bytes()
        (output / (tile + '.bin')).write_bytes(gzip.compress(payload, compresslevel=6, mtime=0))
(output / 'index.json').write_text(json.dumps(dict(sourceTime=reader.header.get('osmosis_replication_timestamp'),
    license='ODbL-1.0', attribution='© OpenStreetMap contributors', tiles=sorted(tiles)), separators=(',', ':')))

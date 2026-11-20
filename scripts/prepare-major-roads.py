"""Index OSM arterial ways by geographic tile for the printable map (pyosmium)."""
import gzip
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import osmium

pbf, output = map(Path, sys.argv[1:])
classes = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']
tiles = defaultdict(list)
signals = {}
for node in osmium.FileProcessor(str(pbf), entities=osmium.osm.NODE).with_filter(osmium.filter.KeyFilter('name', 'name:ko')):
    if node.tags.get('highway') == 'traffic_signals' or node.tags.get('junction') == 'yes':
        signals[node.id] = (node.version, node.tags.get('name:ko') or node.tags['name'])
reader = osmium.FileProcessor(str(pbf)).with_locations('sparse_mem_array')
for way in reader.with_filter(osmium.filter.TagFilter(*[('highway', value) for value in classes])):
    if not way.is_way() or len(way.nodes) < 2 or not all(n.location.valid() for n in way.nodes):
        continue
    t = way.tags
    nodes = [[n.ref, round(n.lon * 1e7), round(n.lat * 1e7)] for n in way.nodes]
    x, y = zip(*[(row[1] / 1e7, row[2] / 1e7) for row in nodes])
    row = [way.id, way.version, t.get('name:ko') or t.get('name') or '', t['highway'],
           '/'.join(t.get(key, '') for key in ('layer', 'bridge', 'tunnel')), nodes]
    one_way = t.get('oneway') in ('yes', '1', 'true', '-1')
    if t.get('oneway') == '-1':
        nodes.reverse()
    named = [[ref, *signals[ref]] for ref, _, _ in nodes if ref in signals]
    if one_way or named:
        row.extend([int(one_way), named])
    for tx in range(math.floor(min(x) * 8), math.floor(max(x) * 8) + 1):
        for ty in range(math.floor(min(y) * 8), math.floor(max(y) * 8) + 1):
            tiles[(tx, ty)].append(row)

output.mkdir(parents=True, exist_ok=True)
for (x, y), rows in tiles.items():
    data = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode()
    (output / f'{x}-{y}.bin').write_bytes(gzip.compress(data, compresslevel=6, mtime=0))
manifest = dict(sourceTime=reader.header.get('osmosis_replication_timestamp'),
                license='ODbL-1.0', attribution='© OpenStreetMap contributors',
                tiles=sorted(f'{x}-{y}' for x, y in tiles))
(output / 'index.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')

"""Build printable minor-road and pedestrian geometry tiles from the Korean OSM extract."""
import gzip
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import osmium

pbf, output = map(Path, sys.argv[1:])
output.mkdir(parents=True, exist_ok=True)
vehicle = {'residential', 'unclassified', 'living_street', 'service'}
foot = {'footway', 'path', 'pedestrian', 'steps'}
restricted = {'no', 'private', 'customers', 'permit', 'delivery'}
reader = osmium.FileProcessor(str(pbf)).with_locations('sparse_mem_array')
tiles = set()
with TemporaryDirectory() as tmp:
    for way in reader.with_filter(osmium.filter.TagFilter(*[('highway', h) for h in vehicle | foot])):
        if not way.is_way() or len(way.nodes) < 2:
            continue
        tags = way.tags
        if (tags.get('area') == 'yes' or tags.get('indoor') == 'yes' or
                tags.get('access') in restricted or tags.get('foot') in restricted or
                tags.get('service') in {'driveway', 'parking_aisle', 'drive-through', 'emergency_access'} or
                not all(n.location.valid() for n in way.nodes)):
            continue
        points = [(round(n.lon * 1e6), round(n.lat * 1e6)) for n in way.nodes]
        xs, ys = zip(*points)
        coords = list(points[0])
        for (x, y), (nx, ny) in zip(points, points[1:]):
            coords.extend((nx - x, ny - y))
        row = [way.id, tags.get('name:ko') or tags.get('name') or '', int(tags['highway'] in foot), coords]
        line = json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n'
        for x in range(min(xs) * 8 // 1000000, max(xs) * 8 // 1000000 + 1):
            for y in range(min(ys) * 8 // 1000000, max(ys) * 8 // 1000000 + 1):
                key = f'{x}-{y}'
                tiles.add(key)
                with (Path(tmp) / key).open('a', encoding='utf-8') as tile:
                    tile.write(line)
    for key in sorted(tiles):
        (output / (key + '.bin')).write_bytes(gzip.compress((Path(tmp) / key).read_bytes(), compresslevel=6, mtime=0))
(output / 'index.json').write_text(json.dumps(dict(license='ODbL-1.0', attribution='© OpenStreetMap contributors',
    sourceTime=reader.header.get('osmosis_replication_timestamp'), tiles=sorted(tiles)), separators=(',', ':')) + '\n')

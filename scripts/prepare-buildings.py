"""Build printable wayfinding landmark tiles from the same Korean OSM PBF as the roads."""
import gzip
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import osmium


def priority(t):
    amenity, shop = t.get('amenity'), t.get('shop')
    if amenity in ('townhall', 'courthouse', 'exhibition_centre') or t.get('tourism') == 'museum' or shop in ('mall', 'department_store'):
        return 0
    if amenity in ('hospital', 'library', 'theatre', 'arts_centre', 'university') or t.get('historic') == 'castle':
        return 1
    if (amenity in ('school', 'police', 'fire_station', 'post_office', 'community_centre')
            or t.get('tourism') == 'hotel' or t.get('office') == 'government'
            or t.get('leisure') == 'park' or shop == 'supermarket' or amenity == 'bank'):
        return 2
    if t.get('building') in ('public', 'civic', 'government', 'commercial', 'office', 'hotel', 'retail', 'hospital'):
        return 3
    if t.get('building') == 'yes' and any(x in (t.get('name:ko') or t.get('name', ''))
                                           for x in ('빌딩', '타워', '회관', '호텔', '백화점')):
        return 3
    return None


source, output = map(Path, sys.argv[1:])
reader = osmium.FileProcessor(str(source)).with_locations('sparse_mem_array')
named = osmium.filter.KeyFilter('name', 'name:ko')
reader.with_areas(named).with_filter(osmium.filter.KeyFilter('name', 'name:ko'))
tiles = defaultdict(list)
for obj in reader:
    if not (obj.is_node() or obj.is_area()):
        continue
    t = obj.tags
    name = (t.get('name:ko') or t.get('name') or '').strip()
    if t.get('amenity') == 'townhall':
        short = t.get('alt_name:ko', '').split(';')[0]
        if short and len(short) < len(name):
            name = short
    if t.get('shop') == 'department_store':
        brand = t.get('brand:ko') or t.get('brand') or ''
        if brand.startswith(name):
            name = brand
    if obj.is_node() and (name.startswith(('(주)', '㈜', '주식회사')) or t.get('indoor') or t.get('level')):
        continue
    kind = ('stop' if t.get('highway') == 'bus_stop' else
            'shop' if t.get('shop') == 'convenience' else None)
    if not kind and (t.get('amenity') in ('restaurant', 'cafe', 'pharmacy') or t.get('shop') == 'bakery'):
        floor = t.get('addr:floor', '')
        if floor in ('', '1', '1층', '지상1층', '지상 1층') and not t.get('indoor'):
            kind = 'storefront'
    rank = 6 if kind == 'storefront' else 2 if kind else priority(t)
    if rank is None or len(name) < 2 or len(name) > 48 or name.isdecimal():
        continue
    if obj.is_node():
        if not obj.location.valid():
            continue
        lon, lat = obj.lon, obj.lat
        ref = f'node/{obj.id}'
        rank += 1
    else:
        points = [(n.lon, n.lat) for ring in obj.outer_rings() for n in ring if n.location.valid()]
        if not points:
            continue
        xs, ys = zip(*points)
        lon, lat = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        ref = ('way/' if obj.from_way() else 'relation/') + str(obj.orig_id())
    row = [ref, name, round(lon, 7), round(lat, 7), rank]
    if kind:
        row.append(kind)
    tiles[f'{math.floor(lon*4)}-{math.floor(lat*4)}'].append(row)

output.mkdir(parents=True, exist_ok=True)
for key, rows in tiles.items():
    payload = json.dumps(sorted(rows), ensure_ascii=False, separators=(',', ':')).encode()
    (output / (key + '.bin')).write_bytes(gzip.compress(payload, compresslevel=6, mtime=0))
manifest = dict(sourceTime=reader.header.get('osmosis_replication_timestamp'),
                license='ODbL-1.0', attribution='© OpenStreetMap contributors',
                tiles=sorted(tiles))
(output / 'index.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
print(sum(map(len, tiles.values())), 'named landmarks')

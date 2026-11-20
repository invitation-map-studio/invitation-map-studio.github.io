"""Build same-origin road-number lookup shards from a licensed Korean OSM PBF.

Usage: python scripts/prepare-address-index.py south-korea-latest.osm.pbf public/address-index
Requires pyosmium 4.3.2. Distributes geographic address fields only, without personal tags.
"""
import gzip
import hashlib
import json
import math
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

import osmium


def bounds(way):
    if any(not n.location.valid() for n in way.nodes):
        return None
    points = [(n.lon, n.lat) for n in way.nodes]
    if not points:
        return None
    x, y = zip(*points)
    return min(x), min(y), max(x), max(y)


def write_index(pbf, output):
    output.mkdir(parents=True, exist_ok=True)
    buckets = [defaultdict(list) for _ in range(256)]
    pending = {}
    members = defaultdict(list)
    areas = defaultdict(list)
    total = 0

    def add(meta, x, y):
        nonlocal total
        street, number, identifier, area, title = meta
        if not math.isfinite(x+y) or not (124 < x < 132 and 32 < y < 40):
            return
        idx = hashlib.sha256(street.encode()).digest()[0]
        buckets[idx][street].append([number,identifier,round(y,7),round(x,7),area,title])
        total += 1

    data = osmium.FileProcessor(str(pbf)).with_locations('sparse_mem_array')
    timestamp = data.header.get('osmosis_replication_timestamp')
    if not timestamp:
        raise ValueError('The OSM extract must have a source timestamp')
    for e in data.with_filter(osmium.filter.KeyFilter('addr:street')):
        t = e.tags
        number = t.get('addr:housenumber', '')
        street = unicodedata.normalize('NFC', t['addr:street'].strip())
        if not re.fullmatch(r'\d{1,5}(-\d{1,5})?', number) or not 1 <= len(street) <= 80:
            continue
        area = ' '.join(filter(None,[t.get('addr:city'), t.get('addr:district')]))[:80]
        public_facility = any(t.get(k) for k in ['amenity','tourism','shop','office','public_transport','leisure']) or t.get('building') in ('public','government','hospital','commercial','retail','school','hotel')
        title = (t.get('name:ko') or t.get('name') or '')[:80] if public_facility else ''
        meta = (street,number,e.type_str()+str(e.id),area,title)
        if e.is_node():
            if e.location.valid():
                add(meta,e.lon,e.lat)
        elif e.is_way():
            box = bounds(e)
            if box:
                add(meta,(box[0]+box[2])/2,(box[1]+box[3])/2)
        elif e.is_relation():
            pending[e.id] = meta
            for m in e.members:
                if m.type == 'w' and m.role in ('', 'outer'):
                    members[m.ref].append(e.id)
    if members:
        ways = osmium.FileProcessor(str(pbf)).with_locations('sparse_mem_array')
        for w in ways.with_filter(osmium.filter.IdFilter(members.keys())):
            if w.is_way() and w.id in members:
                box = bounds(w)
                if box:
                    for r in members[w.id]:
                        areas[r].append(box)
        for r,boxes in areas.items():
            add(pending[r],(min(b[0] for b in boxes)+max(b[2] for b in boxes))/2,
                (min(b[1] for b in boxes)+max(b[3] for b in boxes))/2)
    for i,bucket in enumerate(buckets):
        payload=json.dumps(bucket,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()
        (output/f'{i:02x}.bin').write_bytes(gzip.compress(payload,compresslevel=6,mtime=0))
    manifest={'osmBase':timestamp,'recordCount':total,'buckets':256,'source':'https://download.geofabrik.de/asia/south-korea.html',
              'license':'ODbL-1.0','sourceFileSha256':hashlib.sha256(pbf.read_bytes()).hexdigest(),
              'attribution':'© OpenStreetMap contributors · https://www.openstreetmap.org/copyright'}
    (output/'source.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(total,'geographic addresses',timestamp)


if __name__ == '__main__':
    write_index(Path(sys.argv[1]),Path(sys.argv[2]))

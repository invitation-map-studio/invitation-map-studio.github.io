"""Build an address-only Korean commercial building index from data.go.kr dataset 15083033."""
import csv
import gzip
import hashlib
import io
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

source, output = map(Path, sys.argv[1:])
output.mkdir(parents=True, exist_ok=True)
shards = defaultdict(dict)
with zipfile.ZipFile(source) as archive:
    for filename in sorted(archive.namelist()):
        if not filename.lower().endswith('.csv'):
            continue
        with io.TextIOWrapper(archive.open(filename), encoding='utf-8-sig', newline='') as f:
            for row in csv.DictReader(f):
                address = row['도로명주소'].strip()
                parts = address.split()
                if len(parts) < 3 or not row['위도'] or not row['경도']:
                    continue
                lat, lon = float(row['위도']), float(row['경도'])
                if not (33 <= lat <= 39 and 124 <= lon <= 132):
                    continue
                street = parts[-2]
                shard = hashlib.sha256(street.encode()).hexdigest()[:2]
                # Multiple businesses in one building share its representative point.
                # Retain distinct buildings at the same civic address as separate choices.
                key = (address, round(lat * 1e5), round(lon * 1e5))
                name = row['건물명'] or ''
                if '예식장' in row['표준산업분류명']:
                    name = row['상호명'] + (' ' + row['지점명'] if row['지점명'] else '')
                    shards[shard][key] = name
                else:
                    shards[shard].setdefault(key, name)
count = 0
for shard, entries in shards.items():
    streets = defaultdict(list)
    for (address, lat, lon), name in sorted(entries.items()):
        region, street, number = address.rsplit(' ', 2)
        streets[street].append([number, region, lat, lon, name])
    (output / (shard + '.bin')).write_bytes(gzip.compress(json.dumps(streets, ensure_ascii=False,
        separators=(',', ':')).encode(), compresslevel=6, mtime=0))
    count += len(entries)
(output / 'source.json').write_text(json.dumps(dict(source='소상공인시장진흥공단 상가(상권)정보',
    url='https://www.data.go.kr/data/15083033/fileData.do', release=Path(filename).stem.split('_')[-1],
    locations=count), ensure_ascii=False) + '\n')
print(count, 'commercial building locations')

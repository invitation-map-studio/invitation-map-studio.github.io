"""Build the nearby station index from a South Korea Geofabrik PBF using pyosmium."""
from collections import defaultdict
import json
import re
import sys
from pathlib import Path

import osmium

source, output = map(Path, sys.argv[1:])
nodes = osmium.FileProcessor(str(source), osmium.osm.NODE)
stations = []
entrances = {}
for node in nodes.with_filter(osmium.filter.KeyFilter('railway')):
    tags = node.tags
    if tags.get('railway') == 'subway_entrance':
        ref = tags.get('ref', '').strip()
        if (re.fullmatch(r'[0-9]{1,2}(?:-[0-9]{1,2})?', ref)
                and tags.get('access') not in ('private', 'no') and tags.get('exit') != 'no'
                and tags.get('entrance') != 'entrance' and node.location.valid()):
            entrances[node.id] = [ref, node.location.lon, node.location.lat]
        continue
    if tags.get('railway') not in ('station', 'halt'):
        continue
    if tags.get('station') in ('yard', 'freight') or tags.get('passenger') == 'no':
        continue
    modes = ('subway', 'light_rail', 'monorail')
    network = tags.get('network:ko') or tags.get('network') or ''
    if not (tags.get('station') in modes or any(tags.get(mode) == 'yes' for mode in modes)
            or any(word in network for word in ('도시철도', '전철', '지하철', '경전철'))):
        continue
    name = tags.get('name:ko') or tags.get('name')
    if name and node.location.valid():
        stations.append([node.id, name, node.location.lon, node.location.lat])
# Associate only through explicit stop_area membership, never by proximity.
names = {row[0]: row[1] for row in stations}
owners = defaultdict(set)
area_exits = {}
stop_areas = defaultdict(set)
relations = osmium.FileProcessor(str(source), osmium.osm.RELATION)
for area in relations.with_filter(osmium.filter.TagFilter(('public_transport', 'stop_area'))):
    ids = [m.ref for m in area.members if m.type == 'n']
    area_names = {names[i] for i in ids if i in names}
    if len(area_names) == 1:
        area_exits[area.id] = [i for i in ids if i in entrances]
        for i in area_exits[area.id]:
            owners[i].update(area_names)
        for member in area.members:
            if member.role.startswith(('stop', 'platform')) or (member.type == 'n' and member.ref in names):
                stop_areas[(member.type, member.ref)].add(area.id)

# Match line names to the area's stops/platforms, not to nearby track geometry.
lines = defaultdict(set)
routes = osmium.FileProcessor(str(source), osmium.osm.RELATION)
for route in routes.with_filter(osmium.filter.KeyFilter('route')):
    if route.tags.get('route') not in ('subway', 'light_rail', 'monorail', 'train'):
        continue
    title = (route.tags.get('name:ko') or route.tags.get('name') or '').split(':')[0].strip()
    line = re.search(r'([0-9]+호선|[가-힣·]+선)$', title)
    if not line:
        continue
    for member in route.members:
        if not member.role.startswith(('stop', 'platform')):
            continue
        for area_id in stop_areas.get((member.type, member.ref), ()):
            for i in area_exits[area_id]:
                lines[i].add(line.group(1))
exits = [[i, next(iter(owners[i])), *entrances[i], '·'.join(sorted(lines[i]))]
         for i in sorted(owners) if len(owners[i]) == 1]
index = {'sourceTime': nodes.header.get('osmosis_replication_timestamp'), 'stations': stations, 'exits': exits}
output.write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')) + '\n')

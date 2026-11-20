"""Build the nearby station index from a South Korea Geofabrik PBF using pyosmium."""
import json
import sys
from pathlib import Path

import osmium

source, output = map(Path, sys.argv[1:])
nodes = osmium.FileProcessor(str(source), osmium.osm.NODE)
stations = []
for node in nodes.with_filter(osmium.filter.KeyFilter('railway')):
    tags = node.tags
    if tags.get('railway') not in ('station', 'halt'):
        continue
    if tags.get('station') in ('yard', 'freight') or tags.get('passenger') == 'no':
        continue
    name = tags.get('name:ko') or tags.get('name')
    if name and node.location.valid():
        stations.append([node.id, name, node.location.lon, node.location.lat])
index = {'sourceTime': nodes.header.get('osmosis_replication_timestamp'), 'stations': stations}
output.write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')) + '\n')

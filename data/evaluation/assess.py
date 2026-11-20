"""Inspect the ten published addresses using one local Geofabrik extract (pyosmium 4.3.2)."""
import argparse
from collections import Counter, defaultdict
import json
import math
from pathlib import Path

import osmium

ROOT = Path(__file__).resolve().parent
TYPES = {"n": "node", "w": "way", "r": "relation"}
ROADS = {"primary", "secondary", "tertiary", "trunk", "residential", "unclassified", "service",
         "living_street", "road", "primary_link", "secondary_link", "tertiary_link"}
RADIUS = 350


def distance(point, site):
    x = (point[0] - site["lon"]) * 111320 * math.cos(math.radians(site["lat"]))
    y = (point[1] - site["lat"]) * 111320
    return math.hypot(x, y)


def grid(point):
    return (math.floor(point[0] * 100), math.floor(point[1] * 100))


def evaluate(pbf, directory):
    sites = json.loads((ROOT / "addresses.json").read_text())
    expected = {tuple(r["address"].split()[-2:]) for r in sites}
    references = {r["site"] for r in sites}
    candidates = defaultdict(list)
    members = defaultdict(set)
    sites_by_id = {}
    streets = {street for street, number in expected}
    select = osmium.filter.TagFilter(*[("addr:street", street) for street in streets])
    for obj in osmium.FileProcessor(pbf).with_filter(select):
        t = obj.tags
        key = (t.get("addr:street"), t.get("addr:housenumber"))
        if key in expected:
            candidates[key].append({"id": f"{TYPES[obj.type_str()]}/{obj.id}",
                                    "name": t.get("name:ko") or t.get("name") or ""})
    # Resolve the reviewer's matched site object, including the component ways of multipolygons.
    ids = [int(ref.split("/")[1]) for ref in references]
    for obj in osmium.FileProcessor(pbf).with_filter(osmium.filter.IdFilter(ids)):
        ref = f"{TYPES[obj.type_str()]}/{obj.id}"
        if ref not in references:
            continue
        sites_by_id[ref] = {"version": obj.version, "name": obj.tags.get("name:ko") or obj.tags.get("name")}
        if obj.is_way():
            members[obj.id].add(ref)
        if obj.is_relation():
            for member in obj.members:
                if member.type == "w" and member.role in ("outer", ""):
                    members[member.ref].add(ref)
    sites_by_ref_points = defaultdict(list)
    processor = osmium.FileProcessor(pbf).with_locations("sparse_mem_array")
    base = processor.header.get("osmosis_replication_timestamp")
    for obj in processor.with_filter(osmium.filter.IdFilter(members.keys())):
        if not obj.is_way() or obj.id not in members:
            continue
        vertices = [(n.lon, n.lat) for n in obj.nodes]
        for ref in members[obj.id]:
            sites_by_ref_points[ref].extend(vertices)
    tile_sites = defaultdict(set)
    geos = {}
    records = []
    for index, site in enumerate(sites):
        vertices = sites_by_ref_points[site["site"]]
        xs, ys = zip(*vertices)
        lon, lat = (min(xs) + max(xs))/2, (min(ys) + max(ys))/2
        place = {"id": site["site"], "address": site["address"], "entrance": "site-bbox-center",
                 "lon": round(lon, 8), "lat": round(lat, 8), "radius": RADIUS}
        geos[index] = {"source": "osm", "place": place, "roads": [], "landmarks": []}
        gx, gy = grid((lon, lat))
        for tx in range(gx - 1, gx + 2):
            for ty in range(gy - 1, gy + 2):
                tile_sites[(tx, ty)].add(index)
        matches = candidates[tuple(site["address"].split()[-2:])]
        records.append({**site, "version": sites_by_id[site["site"]]["version"],
                        "sourceName": sites_by_id[site["site"]]["name"], "exactAddressCandidates": matches,
                        "selectedByAddress": site["site"] in [m["id"] for m in matches]})

    # Only retain short-range candidates. The inventory counts ways with a mapped vertex in range.
    wanted = osmium.filter.KeyFilter("highway", "amenity", "railway")
    reader = osmium.FileProcessor(pbf).with_locations("sparse_mem_array").with_filter(wanted)
    for obj in reader:
        t = obj.tags
        if obj.is_node() and t.get("name") and (t.get("amenity") or t.get("railway") == "station"):
            point = [obj.lon, obj.lat]
            for index in tile_sites.get(grid(point), ()):
                if distance(point, geos[index]["place"]) <= RADIUS:
                    geos[index]["landmarks"].append({"id": f"node/{obj.id}", "version": obj.version,
                        "name": t.get("name:ko") or t.get("name"), "point": point})
        if not obj.is_way() or t.get("highway") not in ROADS:
            continue
        indices = set()
        for n in obj.nodes:
            if not n.location.valid():
                continue
            point = (n.lon, n.lat)
            for index in tile_sites.get(grid(point), ()):
                if index not in indices and distance(point, geos[index]["place"]) <= RADIUS:
                    indices.add(index)
        if indices:
            if not all(n.location.valid() for n in obj.nodes):
                raise ValueError(f"Incomplete way {obj.id}")
            road = {"id": obj.id, "version":obj.version, "highway":t.get("highway"),
                    "name": t.get("name:ko") or t.get("name") or "",
                    "level": "/".join(t.get(k, "") for k in ("layer","bridge","tunnel")),
                    "nodes": [n.ref for n in obj.nodes], "points": [[n.lon,n.lat] for n in obj.nodes]}
            for index in indices:
                geos[index]["roads"].append(road)
    for index, row in enumerate(records):
        geo = geos[index]
        roadnodes = Counter(n for r in geo["roads"] for n in set(r["nodes"]))
        row.update({"center": [geo["place"]["lon"],geo["place"]["lat"]], "roads": len(geo["roads"]),
                    "landmarks":len(geo["landmarks"]), "sharedNodes":sum(n > 1 for n in roadnodes.values()),
                    "namedRoads":sorted({r["name"] for r in geo["roads"] if r["name"]}),
                    "levelTaggedWays":sum(bool(r["level"].strip("/")) for r in geo["roads"])})
        (directory / f"{index+1:02d}.json").write_text(json.dumps(geo,ensure_ascii=False,separators=(",",":")))
    result = {"source": "Geofabrik South Korea / OpenStreetMap", "license":"ODbL-1.0",
        "attribution":"© OpenStreetMap contributors · https://www.openstreetmap.org/copyright",
        "osmBase":base,"radius":RADIUS,"records":records}
    (directory / "results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pbf")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    evaluate(args.pbf, args.output)

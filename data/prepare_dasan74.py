"""Convert a complete OSM map/Overpass JSON extract to a public, geodetic fixture."""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

BOUNDS = {"south": 37.6115, "west": 127.159, "north": 37.6187, "east": 127.168}
SITE = 825237097
ATTRIBUTION = "© OpenStreetMap contributors"
KEYS = {"highway", "name", "name:ko", "bridge", "tunnel", "layer", "oneway",
        "access", "service", "amenity", "leisure", "landuse", "entrance", "foot", "motor_vehicle"}


def include(element):
    tags = element.get("tags", {})
    if element["type"] == "way":
        return ("highway" in tags or element["id"] == SITE or
                "name" in tags and ("amenity" in tags or "leisure" in tags))
    if element["type"] == "node":
        return "entrance" in tags or "name" in tags and (
            "amenity" in tags or tags.get("highway") == "bus_stop")
    return False


def center(points):
    """Area centroid for a closed small polygon, using local lon/lat offsets."""
    origin = points[0]
    ring = [(p["lon"] - origin["lon"], p["lat"] - origin["lat"]) for p in points]
    cross = x = y = 0
    for (ax, ay), (bx, by) in zip(ring, ring[1:]):
        area = ax * by - bx * ay
        cross += area
        x += (ax + bx) * area
        y += (ay + by) * area
    if ring[0] != ring[-1] or cross == 0:
        raise ValueError("A closed polygon with nonzero area is required")
    return {"lat": round(origin["lat"] + y / (3 * cross), 7),
            "lon": round(origin["lon"] + x / (3 * cross), 7)}


def prepare(source, fetched_at):
    raw = source.read_bytes()
    document = json.loads(raw)
    if document.get("remark"):
        raise ValueError("Partial Overpass response")
    nodes = {e["id"]: {"lat": e["lat"], "lon": e["lon"]} for e in document["elements"]
             if e["type"] == "node"}
    elements = []
    for original in document["elements"]:
        if not include(original):
            continue
        element = {k: original[k] for k in ("type", "id", "version", "timestamp")}
        element["tags"] = {k: v for k, v in original["tags"].items() if k in KEYS}
        if element["type"] == "node":
            element.update(nodes[element["id"]])
        else:
            element["nodes"] = original["nodes"]
            element["geometry"] = [nodes[n] for n in original["nodes"]]
            if element["nodes"][0] == element["nodes"][-1] and len(set(element["nodes"])) >= 3:
                element["center"] = center(element["geometry"])
        elements.append(element)
    elements.sort(key=lambda e: (e["type"], e["id"]))
    site = next(e for e in elements if e["type"] == "way" and e["id"] == SITE)
    if site["tags"].get("name") != "다산신도시 자연앤푸르지오":
        raise ValueError("Site identity changed. Review the address and boundary.")
    roads = [e for e in elements if e["type"] == "way" and "highway" in e["tags"]]
    if not any(e["tags"].get("name") == "다산중앙로82번안길" for e in roads):
        raise ValueError("Expected access road missing. Review source coverage.")
    # The map preview is wider than it is high (1248 by 885). Keep its entire
    # footprint inside the downloaded bounds. Snap down to a metre.
    lat, lon = site["center"]["lat"], site["center"]["lon"]
    meters_per_degree = 111320
    horizontal = min(lon - BOUNDS["west"], BOUNDS["east"] - lon)
    vertical = min(lat - BOUNDS["south"], BOUNDS["north"] - lat)
    radius = int(min(horizontal * meters_per_degree * math.cos(math.radians(lat)) * 440 / 624,
                     vertical * meters_per_degree * 440 / 445))
    if radius <= 0:
        raise ValueError("The site is outside the downloaded bounds")
    address = "경기도 남양주시 다산중앙로82번안길 74"
    place = {"address": address, "id": f"way/{SITE}", "lat": lat, "lon": lon,
             "entrance": "site-centroid", "radius": radius}
    driveable = {"primary", "secondary", "tertiary", "trunk", "residential", "unclassified",
                 "service", "living_street", "road", "primary_link", "secondary_link",
                 "tertiary_link", "trunk_link"}
    geo_roads = []
    for road in roads:
        t = road["tags"]
        if t["highway"] not in driveable:
            continue
        geo_roads.append({"id": road["id"], "version": road["version"],
                          "name": t.get("name:ko", t.get("name", "")), "highway": t["highway"],
                          "level": "/".join(t.get(k, "") for k in ("layer", "bridge", "tunnel")),
                          "nodes": road["nodes"], "points": [[p["lon"], p["lat"]] for p in road["geometry"]]})
    landmarks = []
    for element in sorted(elements, key=lambda e: e["type"] == "node"):
        tags = element["tags"]
        if not (tags.get("amenity") in {"school", "library", "community_centre"} or
                tags.get("highway") == "bus_stop" or tags.get("leisure") == "park"):
            continue
        location = element.get("center", element)
        if "lon" not in location or "name" not in tags:
            continue
        name = tags.get("name:ko", tags["name"])
        if tags.get("highway") == "bus_stop":
            name += " 정류장"
        landmarks.append({"id": f"{element['type']}/{element['id']}", "version": element["version"],
                          "name": name,
                          "point": [location["lon"], location["lat"]]})
    geography = {"source": "osm", "place": place, "roads": geo_roads, "landmarks": landmarks}
    osm_api = "bounds" in document
    return {
        "schemaVersion": 1, "address": address, "geo": geography,
        "name": site["tags"]["name"],
        "location": {**site["center"], "kind": "site-centroid", "osmId": f"way/{SITE}",
                     "version": site["version"]}, "crs": "EPSG:4326",
        "bounds": BOUNDS, "fetchedAt": fetched_at,
        "source": {"provider": "OpenStreetMap", "attribution": ATTRIBUTION,
                   "license": "ODbL-1.0", "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
                   "copyrightUrl": "https://www.openstreetmap.org/copyright",
                   "endpoint": "https://api.openstreetmap.org/api/0.6/map.json" if osm_api
                   else "https://overpass.private.coffee/api/interpreter",
                   "responseSha256": hashlib.sha256(raw).hexdigest(),
                   "datasetAt": document.get("osm3s", {}).get("timestamp_osm_base")},
        "evidence": {"addressSiteMatch": "경기주택도시공사 주택목록의 주소·단지명과 OSM 단지명을 대조",
                     "addressSource": "https://apply.gh.or.kr/co/cop/selectAstMngListPopup.do",
                     "addressCheckedOn": "2026-11-20",
                     "geometrySource": f"https://www.openstreetmap.org/way/{SITE}",
                     "verificationStatus": "needs-review", "verifiedAt": None,
                     "pedestrianEntrance": None, "vehicleEntrance": None},
        "elements": elements,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--fetched-at", required=True, help="Original UTC receipt time")
    args = parser.parse_args()
    moment = datetime.fromisoformat(args.fetched_at.replace("Z", "+00:00"))
    if moment.utcoffset() != timezone.utc.utcoffset(moment):
        parser.error("Use a UTC receipt time with an explicit offset")
    fixture = prepare(args.source, args.fetched_at)
    args.output.write_text(json.dumps(fixture, ensure_ascii=False, separators=(",", ":")) + "\n",
                           encoding="utf-8")

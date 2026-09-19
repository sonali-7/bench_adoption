#!/usr/bin/env python3
"""Clip and clean public GIS for Van Cortlandt Park (NYC Parks ID X092)."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data"
OUT = ROOT / "data" / "processed"
OUT.mkdir(parents=True, exist_ok=True)


def point_in_ring(lon: float, lat: float, ring: list) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat):
            denom = (yj - yi) if yj != yi else 1e-16
            xint = (xj - xi) * (lat - yi) / denom + xi
            if lon < xint:
                inside = not inside
        j = i
    return inside


def point_in_polygon(lon: float, lat: float, geom: dict) -> bool:
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polys:
        if point_in_ring(lon, lat, poly[0]) and not any(
            point_in_ring(lon, lat, hole) for hole in poly[1:]
        ):
            return True
    return False


def round_coords(obj, ndigits=6):
    if isinstance(obj, (int, float)):
        return round(float(obj), ndigits)
    if isinstance(obj, list):
        return [round_coords(x, ndigits) for x in obj]
    return obj


def main() -> None:
    park_fc = json.loads((RAW / "park-boundary.raw.geojson").read_text())
    park_feat = park_fc["features"][0]
    park_geom = park_feat["geometry"]
    park_props = park_feat["properties"]

    park_out = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": park_props.get("signname"),
                    "park_id": park_props.get("gispropnum"),
                    "acres": float(park_props.get("acres") or 0),
                    "borough": park_props.get("borough"),
                    "location": park_props.get("location"),
                    "typecategory": park_props.get("typecategory"),
                    "source": "NYC Open Data — Parks Properties (enfh-gkve)",
                },
                "geometry": {
                    "type": park_geom["type"],
                    "coordinates": round_coords(park_geom["coordinates"], 6),
                },
            }
        ],
    }
    (OUT / "park-boundary.geojson").write_text(json.dumps(park_out))

    trails_raw = json.loads((RAW / "trails.raw.geojson").read_text())
    grouped = defaultdict(list)
    for feat in trails_raw["features"]:
        name = feat["properties"].get("trail_name") or "Unnamed Official Trail"
        grouped[name].append(feat)

    trail_features = []
    for name, feats in grouped.items():
        props = feats[0]["properties"]
        geoms = []
        for f in feats:
            g = f["geometry"]
            if g["type"] == "LineString":
                geoms.append(round_coords(g["coordinates"], 6))
            elif g["type"] == "MultiLineString":
                geoms.extend(round_coords(g["coordinates"], 6))
        trail_features.append(
            {
                "type": "Feature",
                "properties": {
                    "trail_name": name,
                    "park_id": props.get("parkid"),
                    "park_name": props.get("park_name"),
                    "surface": props.get("surface"),
                    "class": props.get("class"),
                    "difficulty": props.get("difficulty"),
                    "width_ft": props.get("width_ft"),
                    "source": "NYC Open Data — Parks Trails (vjbm-hsyr)",
                    "segment_count": len(feats),
                },
                "geometry": {"type": "MultiLineString", "coordinates": geoms},
            }
        )

    trails_out = {"type": "FeatureCollection", "features": trail_features}
    (OUT / "trails.geojson").write_text(json.dumps(trails_out))

    seating = json.loads((RAW / "osm-seating.raw.json").read_text())
    benches = []
    skipped = 0
    for el in seating["elements"]:
        tags = el.get("tags") or {}
        if tags.get("amenity") != "bench":
            continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lon is None:
            skipped += 1
            continue
        if not point_in_polygon(float(lon), float(lat), park_geom):
            skipped += 1
            continue
        extra = {
            k: v
            for k, v in tags.items()
            if k
            not in {
                "amenity",
            }
        }
        benches.append(
            {
                "type": "Feature",
                "properties": {
                    "gis_id": f"osm-{el['type']}-{el['id']}",
                    "osm_id": el["id"],
                    "osm_type": el["type"],
                    "gis_source": "OpenStreetMap amenity=bench",
                    "material": tags.get("material"),
                    "backrest": tags.get("backrest"),
                    "bench_type": tags.get("bench:type"),
                    "name": tags.get("name"),
                    "extra": extra,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(float(lon), 7), round(float(lat), 7)],
                },
            }
        )

    benches_out = {"type": "FeatureCollection", "features": benches}
    (OUT / "benches.geojson").write_text(json.dumps(benches_out, indent=2))

    meta = {
        "park_id": "X092",
        "park_name": "Van Cortlandt Park",
        "boundary_source": "NYC Open Data Parks Properties dataset enfh-gkve, filtered to gispropnum=X092",
        "trails_source": "NYC Open Data Parks Trails dataset vjbm-hsyr, filtered to parkid=X092",
        "bench_source": "OpenStreetMap amenity=bench nodes/ways, clipped to the official X092 park polygon",
        "nyc_parks_bench_layer": None,
        "notes": [
            "NYC Parks AMPS Assets (e25p-jzfy) does not include a public bench/furniture class for X092.",
            "NYC DOT City Bench / Seating Locations are street furniture and do not fall inside the X092 polygon.",
            "Adoption records in this application are demonstration data, not official NYC Parks donation records.",
        ],
        "bench_count": len(benches),
        "trail_count": len(trail_features),
        "benches_skipped_outside_park": skipped,
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()

"""
Transform a CSV + config YAML and inject the result into index.html for dev.

Usage:
    python scripts/update_dev.py <csv> <config_yaml>

Example:
    python scripts/update_dev.py public/examples/census_tissue_general_counts_primary.csv \
        public/examples/census_tissue_general_zoom.yaml

Rerun after changing the transform, the example CSV/YAML or the cube data format;
see "Keeping the development page data up to date" in the README.
"""

import sys
import json
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "python-pkg", "src"))

from metacube.transform import csv_to_cube_data


def aggregate_records(records: list) -> list:
    """Collapse multiple records with the same (x,y,z) into one cell."""
    cells = defaultdict(lambda: {"size": 0, "color": 0.0, "datasets": []})
    for r in records:
        key = (r["x"], r["y"], r["z"])
        cells[key]["size"] += r["size"]
        cells[key]["color"] += r.get("color", 0.0)
        for ds in r.get("datasets", []):
            if ds not in cells[key]["datasets"]:
                cells[key]["datasets"].append(ds)
    return [
        {"x": k[0], "y": k[1], "z": k[2],
         "size": v["size"], "color": v["color"], "datasets": v["datasets"]}
        for k, v in cells.items()
    ]


def pre_aggregate(data: dict) -> dict:
    """Aggregate outer records and any inner-cube / slice-zoom drilldown records."""
    data["records"] = aggregate_records(data["records"])

    if "drilldown" in data:
        for key, val in data["drilldown"].items():
            if isinstance(val, dict) and "records" in val:
                val["records"] = aggregate_records(val["records"])

    return data


def inject_into_index(data: dict, index_path: str) -> None:
    content = open(index_path).read()
    marker = "window.__CUBE_DATA__ = "
    end_marker = ";\n    </script>"
    start = content.index(marker)
    end = content.index(end_marker, start) + len(end_marker)
    new_content = (
        content[:start]
        + marker
        + json.dumps(data, separators=(",", ":"))
        + end_marker
        + content[end:]
    )
    open(index_path, "w").write(new_content)


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    csv_path, config_path = sys.argv[1], sys.argv[2]
    index_path = os.path.join(ROOT, "index.html")

    print(f"Transforming {csv_path} with {config_path} ...")
    data = csv_to_cube_data(csv_path, config_path)

    print("Pre-aggregating records ...")
    data = pre_aggregate(data)

    n = len(data["records"])
    size_kb = len(json.dumps(data, separators=(",", ":"))) // 1024
    print(f"  {n} cells | {len(data['xs'])} x · {len(data['ys'])} y · {len(data['zs'])} z | {size_kb} KB")

    print(f"Injecting into {index_path} ...")
    inject_into_index(data, index_path)
    print("Done — refresh the browser.")


if __name__ == "__main__":
    main()

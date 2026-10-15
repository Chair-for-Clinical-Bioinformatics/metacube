"""
Build an ENCODE experiment-metadata CSV for the metacube auto-axis demonstration.

This is the second worked example (alongside CZ CELLxGENE): a *different* modality
(functional genomics) and a *coverage* cube (one row per experiment, so "count" is
the number of experiments per combination, not cells). It exercises
`axes.mode: auto` on categorical columns of widely varying cardinality — exactly
what the auto-axis heuristic is for: low-cardinality balanced columns (organism,
classification, assay) go on the outer faces, high-cardinality columns (biosample,
target) are reserved for the drilldown.

Source: ENCODE Portal REST API (https://www.encodeproject.org), no auth required.

Requirements:
    pip install requests

Output:
    data/encode_experiment_counts.csv
      columns: organism, assay_title, classification, lab, biosample, target, count

Runtime: ~1-2 min (a single paginated /search request). Run in tmux if your
connection is slow.

Usage:
    python scripts/build_encode_counts.py

After running, copy to the example locations:
    cp data/encode_experiment_counts.csv public/examples/
    cp data/encode_experiment_counts.csv python-pkg/src/metacube/examples/
"""

import csv
import os
from collections import defaultdict

import requests

BASE = "https://www.encodeproject.org/search/"

# Fields requested from the portal (embedded dotted paths are resolved server-side).
FIELDS = [
    "assay_title",
    "biosample_ontology.term_name",
    "biosample_ontology.classification",
    "target.label",
    "lab.title",
    "replicates.library.biosample.donor.organism.scientific_name",
]

PARAMS = [("type", "Experiment"), ("format", "json"), ("limit", "all")]
PARAMS += [("field", f) for f in FIELDS]


def _first(seq):
    return seq[0] if isinstance(seq, list) and seq else None


def _organism(exp: dict) -> str:
    """Dig the organism scientific name out of the nested replicate structure."""
    for rep in exp.get("replicates", []) or []:
        org = (((rep.get("library") or {}).get("biosample") or {})
               .get("donor") or {}).get("organism") or {}
        name = org.get("scientific_name")
        if name:
            return name
    return "unknown"


def main() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(script_dir, "..", "data")
    os.makedirs(data_dir, exist_ok=True)
    output_csv = os.path.join(data_dir, "encode_experiment_counts.csv")

    print(f"Querying ENCODE: {BASE} (type=Experiment, all) ...")
    resp = requests.get(
        BASE, params=PARAMS,
        headers={"Accept": "application/json"},
        timeout=300,
    )
    resp.raise_for_status()
    experiments = resp.json().get("@graph", [])
    print(f"  {len(experiments):,} experiments returned")

    # Aggregate to per-combination experiment counts (count = # experiments).
    counts: dict[tuple, int] = defaultdict(int)
    for exp in experiments:
        bo = exp.get("biosample_ontology") or {}
        target = exp.get("target") or {}
        lab = exp.get("lab") or {}
        key = (
            _organism(exp),
            exp.get("assay_title") or "unknown",
            bo.get("classification") or "unknown",
            lab.get("title") or "unknown",
            bo.get("term_name") or "unknown",
            target.get("label") or "none",        # "none" for non-targeted assays
        )
        counts[key] += 1

    cols = ["organism", "assay_title", "classification", "lab", "biosample", "target", "count"]
    with open(output_csv, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for key, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            w.writerow([*key, n])

    print(f"\nWrote {len(counts):,} combinations ({len(experiments):,} experiments) → {output_csv}")
    for i, c in enumerate(cols[:-1]):
        print(f"  {c:16}: {len({k[i] for k in counts}):,} distinct")
    print("\nNext:")
    print("  cp data/encode_experiment_counts.csv public/examples/")
    print("  cp data/encode_experiment_counts.csv python-pkg/src/metacube/examples/")


if __name__ == "__main__":
    main()

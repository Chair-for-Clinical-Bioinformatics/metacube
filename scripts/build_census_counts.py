"""
Build the CellxGene Census counts CSV by aggregating the Census `obs` directly,
keyed on dataset_id, and attaching collection_id (+ readable labels) from the
datasets table.

Why this supersedes fetch_census_tissue_general.py
---------------------------------------------------
The older pipeline pre-aggregated counts by `dataset_title` and joined
`collection_doi` on the title — lossy, because one collection is split into many
dataset_titles (over-counting) and titles collide across collections (ambiguous
join). This script instead groups `obs` by the canonical `dataset_id` (a stable
UUID present per cell) and joins `collection_id` on `dataset_id`, so the output
carries BOTH keys cleanly:

    dataset_id   → "processing/curation" unit  (one separately-curated H5AD)
    collection_id→ "independent study"  unit   (one collection / paper)

The concentration measure (D, N_eff) can then be computed over either unit just
by switching the treemap `category_column` in the YAML — no re-fetch needed to
compare the two structurings. `dataset_title` / `collection_doi` are kept as
human-readable labels.

`tissue_general` is read directly from `obs` (CZI's UBERON-based roll-up), so no
separate tissue-mapping step is required.

Only primary cells are counted (`is_primary_data == True`). Census re-releases many
cells in additional datasets — e.g. a "1 million cells subset" of a survey, or the
"All neurons" / "Supercluster: …" views of the Human Brain Cell Atlas — and marks
those copies as non-primary. Counting them would double-count ~44% of all cells and
inflate the number of contributing datasets.

Requirements:
    pip install cellxgene-census

Output:
    data/census_tissue_general_counts_primary.csv
      columns: organism, tissue_general, tissue, assay, dataset_id,
               collection_id, dataset_title, collection_doi, cell_type, count

Runtime/memory:
    ~10-15 min on a fast connection; peak RAM < ~12 GB. The full obs scan streams
    in Arrow batches and each batch is reduced immediately, so memory stays bounded
    by the number of unique (dataset_id x assay x tissue x cell_type) groups, not by
    the 214M cells. Run it in a tmux/screen session.

Usage:
    python scripts/build_census_counts.py
    python scripts/build_census_counts.py --out public/examples/census_tissue_general_counts_primary.csv

After running, copy the output CSV to the example locations:
    cp data/census_tissue_general_counts_primary.csv public/examples/
    cp data/census_tissue_general_counts_primary.csv python-pkg/src/metacube/examples/
then `pixi run package-template` to refresh the bundled template if needed.
"""

import argparse
import os
import pandas as pd
import cellxgene_census

CENSUS_VERSION = "2025-11-08"

# SSL cert workaround required on some Linux servers.
TILEDB_CONFIG = {"vfs.s3.verify_ssl": False}

# Census experiment keys → display names used in the counts CSV.
ORGANISM_KEYS = {
    "callithrix_jacchus": "Callithrix jacchus",
    "homo_sapiens":       "Homo sapiens",
    "macaca_mulatta":     "Macaca mulatta",
    "mus_musculus":       "Mus musculus",
    "pan_troglodytes":    "Pan troglodytes",
}

# obs columns aggregated into per-combination cell counts. dataset_id is the
# canonical per-dataset key; tissue_general is CZI's UBERON roll-up.
OBS_KEYS = ["dataset_id", "assay", "tissue", "tissue_general", "cell_type"]


def aggregate_organism(census, organism_key: str) -> pd.DataFrame:
    """Stream obs for one organism and aggregate to per-combination cell counts.

    Each Arrow batch is reduced with a groupby immediately and folded into the
    running total, so only unique groups are held in memory (not the raw cells).
    """
    agg: pd.DataFrame | None = None
    n_cells = 0

    # Primary cells only: each cell once, not its re-released copies.
    for batch in census["census_data"][organism_key].obs.read(
        column_names=OBS_KEYS, value_filter="is_primary_data == True"
    ):
        b = batch.to_pandas()
        n_cells += len(b)
        # Match the cube's null policy: replace missing annotations with the explicit
        # literal "unknown" so incompletely-annotated cells stay visible as their own
        # category rather than being silently dropped during aggregation. (Without
        # this, ~1% of cells with a null grouping key vanish — the 212M vs 214M gap.)
        b[OBS_KEYS] = b[OBS_KEYS].astype("object").where(b[OBS_KEYS].notna(), "unknown")
        g = (
            b.groupby(OBS_KEYS, observed=True, dropna=False)
            .size()
            .reset_index(name="count")
        )
        if agg is None:
            agg = g
        else:
            agg = (
                pd.concat([agg, g], ignore_index=True)
                .groupby(OBS_KEYS, observed=True, dropna=False, as_index=False)["count"]
                .sum()
            )

    if agg is None:
        return pd.DataFrame(columns=OBS_KEYS + ["count"])

    print(f"    {n_cells:,} cells → {len(agg):,} combinations")
    return agg


def main() -> None:
    parser = argparse.ArgumentParser(description="Aggregate CellxGene Census obs into the example counts CSV.")
    parser.add_argument("--out", default=None, help="Output CSV (default: data/census_tissue_general_counts_primary.csv)")
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir   = os.path.join(script_dir, "..", "data")
    output_csv = args.out or os.path.join(data_dir, "census_tissue_general_counts_primary.csv")
    os.makedirs(os.path.dirname(os.path.abspath(output_csv)), exist_ok=True)

    print(f"Connecting to CellxGene Census {CENSUS_VERSION} ...")
    frames: list[pd.DataFrame] = []

    with cellxgene_census.open_soma(
        census_version=CENSUS_VERSION,
        tiledb_config=TILEDB_CONFIG,
    ) as census:
        for key, name in ORGANISM_KEYS.items():
            print(f"\n{name} ...")
            try:
                org_agg = aggregate_organism(census, key)
            except Exception as exc:
                print(f"    Warning: skipped ({exc})")
                continue
            if len(org_agg):
                org_agg.insert(0, "organism", name)
                frames.append(org_agg)

        print("\nFetching datasets table from census_info ...")
        datasets = census["census_info"]["datasets"].read().concat().to_pandas()

    if not frames:
        raise SystemExit("No data aggregated — check the Census connection.")

    counts = pd.concat(frames, ignore_index=True)
    print(f"\nAggregated {len(counts):,} rows, {int(counts['count'].sum()):,} cells total")

    # Map dataset_id → collection metadata. dataset_id is the unique dataset key,
    # so this join is unambiguous (no shared-title problem).
    label_cols = [c for c in ["collection_id", "collection_doi", "dataset_title"]
                  if c in datasets.columns]
    ds_map = (
        datasets.drop_duplicates(subset=["dataset_id"])
        .set_index("dataset_id")[label_cols]
        .replace("", pd.NA)  # treat empty strings as missing
    )
    for c in label_cols:
        counts[c] = counts["dataset_id"].map(ds_map[c])

    if "collection_id" in counts.columns:
        n_with = counts["collection_id"].notna().sum()
        print(f"collection_id coverage: {n_with:,} / {len(counts):,} rows "
              f"({100 * n_with / len(counts):.1f}%)")

    col_order = ["organism", "tissue_general", "tissue", "assay",
                 "dataset_id", "collection_id", "dataset_title", "collection_doi",
                 "cell_type", "count"]
    col_order = [c for c in col_order if c in counts.columns]
    counts = counts[col_order]

    counts.to_csv(output_csv, index=False)
    print(f"\nWrote {len(counts):,} rows → {output_csv}")
    print(f"  organisms      : {counts['organism'].nunique()}")
    print(f"  tissue_general : {counts['tissue_general'].nunique()}")
    print(f"  assays         : {counts['assay'].nunique()}")
    print(f"  dataset_id     : {counts['dataset_id'].nunique()}")
    if "collection_id" in counts.columns:
        print(f"  collection_id  : {counts['collection_id'].nunique()}")
    print("\nNext:")
    print(f"  cp {output_csv} public/examples/")
    print(f"  cp {output_csv} python-pkg/src/metacube/examples/")


if __name__ == "__main__":
    main()

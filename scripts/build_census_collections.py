"""
Build the publication lookup table for the CellxGene Census examples.

The counts CSV (build_census_counts.py) carries `dataset_title`, the title of one
Census dataset (a single H5AD). Curators often give these internal names such as
"all.ENDOTHELIA.nocbm" or "Dissection: Hypothalamus …", so they are not the title
of the publication. Publications are Census *collections*; this script maps each
`collection_id` to its title and short citation, from the same Census release as
the counts. The example YAMLs left-join it via `metadata_csv` /
`metadata_join_key: collection_id`, so the large counts CSV stays unchanged.

Requirements:
    pip install cellxgene-census

Output:
    public/examples/census_collections.csv
      columns: collection_id, publication, citation
"""

import argparse
from pathlib import Path

import cellxgene_census

CENSUS_VERSION = "2025-11-08"  # must match the counts CSV snapshot


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--census-version", default=CENSUS_VERSION)
    parser.add_argument("--out", type=Path,
                        default=Path(__file__).resolve().parent.parent / "public/examples/census_collections.csv")
    args = parser.parse_args()

    with cellxgene_census.open_soma(census_version=args.census_version) as census:
        datasets = census["census_info"]["datasets"].read().concat().to_pandas()

    table = (
        datasets[["collection_id", "collection_name", "collection_doi_label"]]
        .drop_duplicates("collection_id")
        .rename(columns={"collection_name": "publication", "collection_doi_label": "citation"})
        .sort_values("collection_id")
    )
    table.to_csv(args.out, index=False)
    print(f"{len(table)} collections → {args.out}")


if __name__ == "__main__":
    main()

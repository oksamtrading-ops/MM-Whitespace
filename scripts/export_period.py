#!/usr/bin/env python3
"""Export a committed period to a clean template.

    python3 scripts/export_period.py <period.db> <out.xlsx> [--csv out.csv] [--period LABEL]

The uploaded workbook is an input artifact and is returned untouched alongside
this file; nothing is written back into it. See docs/design/10-excel-export.md.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from mmparser.export import export_period  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("database")
    ap.add_argument("xlsx")
    ap.add_argument("--csv")
    ap.add_argument("--period")
    args = ap.parse_args(argv)

    result = export_period(args.database, args.xlsx, args.csv, args.period)
    print("exported %d companies from %r" % (result["companies"], result["period"]))
    print("  workbook: %s" % result["xlsx"])
    if result["csv"]:
        print("  flat csv: %s" % result["csv"])
    return 0


if __name__ == "__main__":
    sys.exit(main())

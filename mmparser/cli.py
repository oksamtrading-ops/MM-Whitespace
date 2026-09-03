"""Parse a workbook and render the validation report.

    python3 -m mmparser.cli reference/M\\&M\\ -\\ Whitespace\\ Analysis\\ Q3-2026.xlsx
    python3 -m mmparser.cli <file> --json out.json

Nothing is written anywhere. This produces the report an Analyst confirms
before a period is committed.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter

from .ingest import ingest

BOLD, DIM, RESET = "\033[1m", "\033[2m", "\033[0m"
RED, YELLOW, GREEN = "\033[31m", "\033[33m", "\033[32m"


def _section(title, colour=""):
    print("\n%s%s%s%s" % (colour, BOLD, title, RESET))
    print("%s%s%s" % (DIM, "-" * len(title), RESET))


def render(report, companies, verbose=False):
    period = report.get("period")
    print("%s%sValidation report%s  period %s  %d companies"
          % (BOLD, GREEN if not report["blocking"] else RED, RESET,
             period or "UNRESOLVED", len(companies)))

    blocking = report["blocking"]
    _section("Blocking (%d)" % len(blocking), RED if blocking else GREEN)
    if not blocking:
        print("  none -- this period may be committed once warnings are acknowledged")
    for f in blocking:
        print("  %s* %s%s  %s" % (RED, f.code, RESET, f.detail))

    warnings = report["warnings"]
    _section("Warnings, acknowledgement required (%d)" % len(warnings), YELLOW)
    grouped = {}
    for f in warnings:
        grouped.setdefault(f.code, []).append(f)
    for code, items in sorted(grouped.items(), key=lambda kv: -len(kv[1])):
        print("  %s%-26s%s %d" % (YELLOW, code, RESET, len(items)))
        show = items if verbose else items[:5]
        for f in show:
            print("      %s" % f.detail)
        if len(items) > len(show):
            print("      %s... %d more (--verbose)%s" % (DIM, len(items) - len(show), RESET))

    proofs = report.get("proofs") or {}
    totals = proofs.get("totals") or {}
    _section("Proof totals (%d)" % len(totals))
    for label, (actual, expected) in totals.items():
        ok = actual == expected
        print("  %s%s%s  %-44s %6s vs %-6s"
              % (GREEN if ok else RED, "tie " if ok else "FAIL", RESET, label, actual, expected))
    if proofs:
        print("\n  %sexchange%s %s" % (DIM, RESET, proofs.get("exchanges")))
        print("  %stier (workbook column)%s %s" % (DIM, RESET, proofs.get("tiers")))
        firms = proofs.get("firms") or {}
        top = ", ".join("%s %d" % (k, v) for k, v in
                        sorted(firms.items(), key=lambda kv: -kv[1])[:8])
        print("  %sauditor%s %s" % (DIM, RESET, top))

    info = report["info"]
    _section("Informational (%d)" % len(info))
    for f in info if verbose else info[:10]:
        print("  %s%s%s %s" % (DIM, f.code, RESET, f.detail))
    if not verbose and len(info) > 10:
        print("  %s... %d more (--verbose)%s" % (DIM, len(info) - 10, RESET))

    print()
    return 1 if blocking else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Parse a whitespace workbook and validate it.")
    ap.add_argument("workbook")
    ap.add_argument("--json", help="write companies + report as JSON to this path")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args(argv)

    companies, report = ingest(args.workbook)

    if args.json:
        payload = {
            "period": report.get("period"),
            "companies": [
                {k: v for k, v in c.items() if k not in ("region_provenance",)}
                for c in companies.values()
            ],
            "report": {
                "blocking": [f._asdict() for f in report["blocking"]],
                "warnings": [f._asdict() for f in report["warnings"]],
                "info": [f._asdict() for f in report["info"]],
                "proofs": {k: v for k, v in (report.get("proofs") or {}).items()
                           if k != "totals"},
                "totals": {k: list(v) for k, v in
                           ((report.get("proofs") or {}).get("totals") or {}).items()},
            },
        }
        with open(args.json, "w") as fh:
            json.dump(payload, fh, indent=2, default=str)
        print("wrote %s (%d companies)" % (args.json, len(companies)))

    return render(report, companies, args.verbose)


if __name__ == "__main__":
    sys.exit(main())

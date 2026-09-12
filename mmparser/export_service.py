"""Build the export workbook for the web application.

The download in the application runs here, as a function beside the Next.js
app, for the same reason the upload parser does: Vercel's Node functions have
no Python, and openpyxl -- with the injection guard, the corrected proof
ranges and the notices -- is already written and tested once. Rewriting it in
TypeScript would have meant a second exporter to keep in step with the first.

So the application reads the period out of its own database (SQLite locally,
Postgres in production) and hands the rows to the SAME ``build_workbook`` the
command line uses. This module knows nothing about HTTP or about SQL:
``api/export.py`` adapts it to a request, and src/lib/export/period.ts reads
the database, so either can change without touching the workbook.

Nothing is stored. The bytes are built in memory and returned to the caller.
"""
from __future__ import annotations

import io
import json
import sys

from .export import build_workbook, flat_rows, FLAT_COLUMNS
from .service import Refused

#: A period is 259 companies. This is the point at which the request is a
#: mistake or an attack rather than a workbook.
MAX_COMPANIES = 10_000


def normalise(data):
    """The payload as build_workbook expects it, with every optional key filled.

    A missing key must be a blank cell, never a 500: this payload is built by
    another language reading a database whose columns change over time.
    """
    if not isinstance(data, dict):
        raise Refused(400, "The export payload must be an object.")
    period = data.get("period")
    companies = data.get("companies")
    if not isinstance(period, dict) or not isinstance(companies, list):
        raise Refused(400, "The export payload needs a period and a list of companies.")
    if len(companies) > MAX_COMPANIES:
        raise Refused(413, "That is more companies than a period can hold.")

    period = dict(period)
    period.setdefault("label", "")
    period.setdefault("market_cap_as_of", "")
    period.setdefault("threshold_amount", 0)
    period.setdefault("threshold_operator", "gte")
    period.setdefault("threshold_currency", "CAD")
    period.setdefault("proximity_band_pct", 0)
    period.setdefault("status", "draft")
    period.setdefault("revision", 1)

    provenance = dict(data.get("provenance") or {})
    provenance.setdefault("source_file_sha256", None)
    provenance.setdefault("rule_set_version", period.get("rule_set_version"))
    provenance.setdefault("prior_period", None)

    out = []
    for raw in companies:
        c = dict(raw or {})
        c.setdefault("id", None)
        c.setdefault("name", "")
        c.setdefault("tier", None)
        c.setdefault("status", "")
        c.setdefault("footprint", "")
        c.setdefault("rule_set_version", provenance["rule_set_version"])
        c["values"] = c.get("values") or {}
        # A list over the wire, a set here: build_workbook asks "is this stage in".
        c["stages"] = set(c.get("stages") or [])
        c.setdefault("trace", None)
        c.setdefault("entity_id", None)
        c.setdefault("prior_tier", None)
        out.append(c)

    return {"period": period, "companies": out, "provenance": provenance}


def workbook_bytes(data):
    """The .xlsx as bytes. Same builder, same guards, as the command line."""
    wb = build_workbook(normalise(data))
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def flat_csv_text(data):
    """The flat one-row-per-company CSV, as text. Same injection guard."""
    import csv

    from .export import EXCHANGE_NOTICE, INTERNAL_USE, VENDOR_NOTICE
    from .xlsxwrite import needs_quote_prefix, sanitize

    out = io.StringIO()
    out.write("# %s\n# %s\n# %s\n" % (INTERNAL_USE, EXCHANGE_NOTICE, VENDOR_NOTICE))
    writer = csv.DictWriter(out, fieldnames=FLAT_COLUMNS)
    writer.writeheader()
    for row in flat_rows(normalise(data)):
        safe = {}
        for key, value in row.items():
            value = sanitize(value)
            # A CSV opened in Excel evaluates the same prefixes, and there is no
            # quote-prefix flag to lean on.
            if needs_quote_prefix(value):
                value = "'" + value
            safe[key] = value
        writer.writerow(safe)
    return out.getvalue()


def main(argv=None):
    """JSON payload on stdin, workbook bytes on stdout. The local path.

    `python3 -m mmparser.export_service [--csv] < payload.json > out.xlsx`
    """
    argv = sys.argv[1:] if argv is None else argv
    data = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    if "--csv" in argv:
        sys.stdout.write(flat_csv_text(data))
    else:
        sys.stdout.buffer.write(workbook_bytes(data))
    return 0


if __name__ == "__main__":
    sys.exit(main())

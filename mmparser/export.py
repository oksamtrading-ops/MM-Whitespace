"""Generate a clean, version-controlled template from a committed period.

The uploaded workbook is an INPUT ARTIFACT, not a deliverable. It is returned
untouched alongside this file. Writing back into it fails on both fidelity --
no library round-trips its conditional-formatting extension, charts, legacy
drawing part or add-in defined names -- and correctness, because a faithful
round-trip re-emits the defects the application exists to fix.

Every cell goes through mmparser.xlsxwrite.put. There is no second path.

See docs/design/10-excel-export.md.
"""
from __future__ import annotations

import csv
import json
import sqlite3
from collections import OrderedDict
from typing import Any, Dict, List, Optional

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .xlsxwrite import put, put_row

# --- licence notices ------------------------------------------------------
# The export IS the redistribution event, not the server, so both notices
# travel with the artifact.
#
# NOTE FOR LEGAL: the wording below states the restriction accurately in our
# own words. The verbatim notice required by each licence has not been
# confirmed against the terms and should be before this leaves the practice.
EXCHANGE_NOTICE = (
    "Exchange-derived columns in this file originate from a TSX Group Inc. issuer "
    "extract and are provided for internal use only. Not for redistribution."
)
VENDOR_NOTICE = (
    "Screener-derived columns, where present, originate from a Refinitiv/LSEG "
    "extract and are provided for internal use only. Not for redistribution."
)
INTERNAL_USE = "INTERNAL USE ONLY - contains licensed third-party data."

REGION_COLUMNS = ["AFRICA", "ASIA", "AUS/NZ/PNG", "CANADA",
                  "LATIN AMERICA", "OTHER", "UK/EUROPE", "USA"]
ABROAD_COLUMNS = [r for r in REGION_COLUMNS if r != "CANADA"]

MATRIX_HEADER_ROW = 5
MATRIX_GROUP_ROW = 4
MATRIX_FIRST_DATA_ROW = 6

HEADER_FILL = PatternFill("solid", fgColor="EFF1E9")
GROUP_FILL = PatternFill("solid", fgColor="DCE0D2")
BOLD = Font(bold=True)
WRAP = Alignment(wrap_text=True, vertical="top")

TIER_LABELS = {
    1: "Tier 1", 2: "Tier 2", 3: "Tier 3",
    4: "Tier 4", 5: "Tier 5", 6: "Tier 6",
}
STATUS_LABELS = {
    "unclassified_no_stage_evidence": "Unclassified",
    "unclassified_no_property_evidence": "Unclassified",
    "unclassified_conflicting": "Unclassified",
}


# ------------------------------------------------------------------ reading

def read_period(db_path: str, label: Optional[str] = None) -> Dict[str, Any]:
    """Read one committed period out of the database."""
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        if label:
            period = con.execute(
                "select * from periods where label = ?", (label,)).fetchone()
        else:
            period = con.execute(
                "select * from periods order by market_cap_as_of desc limit 1").fetchone()
        if period is None:
            raise ValueError("no period found in %s" % db_path)

        prior = con.execute(
            """select * from periods
                where status = 'published' and market_cap_as_of < ?
                order by market_cap_as_of desc limit 1""",
            (period["market_cap_as_of"],)).fetchone()

        companies = []
        rows = con.execute(
            """select c.id, c.canonical_name, t.tier, t.status, t.footprint,
                      t.rule_set_version
                 from companies c
                 left join tiers t on t.company_id = c.id and t.period_id = ?
                order by c.canonical_name""", (period["id"],)).fetchall()

        for row in rows:
            values = {
                r["field_key"]: _load(r["value"])
                for r in con.execute(
                    """select field_key, value from company_period_field_values
                        where period_id = ? and company_id = ?""",
                    (period["id"], row["id"]))
            }
            stages = {
                r["stage"] for r in con.execute(
                    """select stage from company_period_stages
                        where period_id = ? and company_id = ?""",
                    (period["id"], row["id"]))
            }
            trace = con.execute(
                """select rule_id, inputs from tier_traces
                    where period_id = ? and company_id = ? and matched = 1
                    order by ord limit 1""",
                (period["id"], row["id"])).fetchone()
            entity = con.execute(
                """select value from company_identifiers
                    where company_id = ? and scheme = 'sp_entity_id' limit 1""",
                (row["id"],)).fetchone()

            prior_tier = None
            if prior is not None:
                pt = con.execute(
                    "select tier, status from tiers where period_id = ? and company_id = ?",
                    (prior["id"], row["id"])).fetchone()
                if pt is not None:
                    prior_tier = pt["tier"]

            companies.append({
                "id": row["id"],
                "name": row["canonical_name"],
                "tier": row["tier"],
                "status": row["status"],
                "footprint": row["footprint"],
                "rule_set_version": row["rule_set_version"],
                "values": values,
                "stages": stages,
                "trace": dict(trace) if trace else None,
                "entity_id": entity["value"] if entity else None,
                "prior_tier": prior_tier,
            })

        provenance = {
            "source_file_sha256": period["source_file_sha256"],
            "rule_set_version": period["rule_set_version"],
            "prior_period": prior["label"] if prior is not None else None,
        }
        return {"period": dict(period), "companies": companies, "provenance": provenance}
    finally:
        con.close()


def _load(raw):
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return raw


# ------------------------------------------------------------------ writing

def _header(ws, row, column, text, fill=HEADER_FILL):
    cell = put(ws, row, column, text)
    cell.font = BOLD
    cell.fill = fill
    cell.alignment = WRAP
    return cell


def build_workbook(data: Dict[str, Any]) -> Workbook:
    wb = Workbook()
    wb.remove(wb.active)
    _cover(wb, data)
    wb.create_sheet("A - Analysis >>")          # dividers: the TOC links to them
    _matrix(wb, data)
    wb.create_sheet("B - Supporting Schedules >>")
    _consolidated(wb, data)
    _auditor(wb, data)
    _provenance(wb, data)
    return wb


def _cover(wb, data):
    ws = wb.create_sheet("Cover")
    p = data["period"]
    ws.column_dimensions["B"].width = 34
    ws.column_dimensions["C"].width = 92

    put(ws, 2, 2, "Mining Whitespace Analysis").font = Font(bold=True, size=14)
    rows = [
        ("Period", p["label"]),
        ("Market cap as of", p["market_cap_as_of"]),
        ("Threshold", "%s %s %s" % (
            "at or above" if p["threshold_operator"] == "gte" else "above",
            p["threshold_currency"], _money(p["threshold_amount"]))),
        ("Proximity band", "%s%%" % p["proximity_band_pct"]),
        ("Status", p["status"]),
        ("Revision", p["revision"]),
        ("Companies", len(data["companies"])),
        ("Rule set version", data["provenance"]["rule_set_version"]),
        ("Prior period", data["provenance"]["prior_period"] or "none - this is the first period"),
    ]
    r = 4
    for label, value in rows:
        _header(ws, r, 2, label)
        put(ws, r, 3, value)
        r += 1

    r += 1
    _header(ws, r, 2, "Licence"); r += 1
    put(ws, r, 2, INTERNAL_USE).font = BOLD; r += 1
    put(ws, r, 2, EXCHANGE_NOTICE); r += 1
    put(ws, r, 2, VENDOR_NOTICE); r += 2

    _header(ws, r, 2, "If the numbers look different"); r += 1
    put(ws, r, 2,
        "The population is 144 TSX and 115 TSXV, with no third exchange. The previous "
        "figure of 143/115/1 was produced by a counting error -- every tier and exchange "
        "count began one row below the data -- plus a hard-coded constant that concealed "
        "it by attributing the dropped company to an exchange with no members."); r += 2

    _header(ws, r, 2, "Not written to this file"); r += 1
    put(ws, r, 2,
        "Deloitte client information is out of scope for this build and is not stored or "
        "exported. The client column header is retained so downstream column references "
        "stay stable, and is blank throughout. The financial-metrics block is omitted "
        "entirely rather than exported empty. Comments are not exported; they live in the "
        "decision log with an author and a timestamp.")


def _matrix(wb, data):
    ws = wb.create_sheet("A.02 Matrix")
    companies = data["companies"]

    groups = {
        2: "Classification", 3: "Company Inputs - TSX/TSXV",
        13: "Management Location - TSX/TSXV Data",
        16: "Stage of Operations",
        21: "Location of Properties",
        25: "Location of Properties - detail",
        35: "Deloitte Tax Client",
        37: "Auditor",
        40: "Audit Fees", 45: "Tax Fees",
    }
    for col, label in groups.items():
        _header(ws, MATRIX_GROUP_ROW, col, label, GROUP_FILL)

    headers = {
        2: "Tier", 3: "#", 4: "Company", 5: "Exchange", 6: "Marketcap\n(in CAD)",
        13: "Head Office", 14: "DTT Market",
        16: "Exploration", 17: "Development", 18: "Production", 19: "Royalty / Streaming",
        21: "Canada vs Abroad", 22: "Properties in Canada?", 23: "Properties Abroad?",
        35: "Yes / No",
        37: "Big 4 Firms", 38: "Others",
        40: "Currency", 41: "Fees", 42: "Fees in CAD", 43: "Fiscal Year",
        45: "Currency", 46: "Fees", 47: "Fees in CAD", 48: "Fiscal Year", 49: "Ratio",
        51: "Company's Website",
        55: "PY Tier", 56: "Same?",
    }
    for i, region in enumerate(REGION_COLUMNS):
        headers[25 + i] = region
    for col, label in headers.items():
        _header(ws, MATRIX_HEADER_ROW, col, label)
    ws.column_dimensions["D"].width = 34
    ws.column_dimensions[get_column_letter(51)].width = 40
    ws.freeze_panes = ws.cell(row=MATRIX_FIRST_DATA_ROW, column=5)

    for n, c in enumerate(companies, start=1):
        row = MATRIX_FIRST_DATA_ROW + n - 1
        v = c["values"]

        # Tier as a VALUE with the rule trace as a comment. Re-deriving the
        # nested condition in the sheet would reintroduce what this removes.
        label = TIER_LABELS.get(c["tier"]) or STATUS_LABELS.get(c["status"], "Unclassified")
        trace_note = None
        if c["trace"]:
            trace_note = "Rule: %s\nInputs: %s\nRule set: %s" % (
                c["trace"]["rule_id"], c["trace"]["inputs"], c["rule_set_version"])
        put(ws, row, 2, label, comment=trace_note)

        put(ws, row, 3, n)                       # presentation only, never an identity key
        put(ws, row, 4, c["name"])
        put(ws, row, 5, v.get("exchange"))
        put(ws, row, 6, v.get("market_cap_cad"), number_format="#,##0.00")
        put(ws, row, 13, v.get("head_office_location"))
        put(ws, row, 14, v.get("dtt_market"))

        for col, stage in ((16, "exploration"), (17, "development"),
                           (18, "production"), (19, "royalty_streaming")):
            put(ws, row, col, "X" if stage in c["stages"] else None)

        # The derived trio stays LIVE, with the corrected else-branch that emits
        # None instead of silently calling "no properties at all" Canada only.
        vcol, wcol = get_column_letter(22), get_column_letter(23)
        put(ws, row, 21,
            '=IF(AND({v}{r}="No",{w}{r}="No"),"None",'
            'IF(AND({v}{r}="Yes",{w}{r}="Yes"),"Canada & Abroad",'
            'IF(AND({v}{r}="No",{w}{r}="Yes"),"Abroad","Canada only")))'.format(
                v=vcol, w=wcol, r=row),
            formula=True)
        canada_col = get_column_letter(25 + REGION_COLUMNS.index("CANADA"))
        put(ws, row, 22, '=IF(COUNTA({c}{r})>0,"Yes","No")'.format(c=canada_col, r=row),
            formula=True)
        abroad_refs = ",".join(
            "%s%d" % (get_column_letter(25 + REGION_COLUMNS.index(a)), row)
            for a in ABROAD_COLUMNS)
        put(ws, row, 23, '=IF(COUNTA(%s)>0,"Yes","No")' % abroad_refs, formula=True)

        regions = v.get("property_regions") or {}
        for i, region in enumerate(REGION_COLUMNS):
            vals = regions.get(region) or []
            put(ws, row, 25 + i, ", ".join(vals) if vals else None)

        # 35 (Deloitte Tax Client) is deliberately left blank: header retained
        # so downstream column references stay stable, no data written.

        auditor = v.get("auditor")
        put(ws, row, 37, auditor)
        put(ws, row, 51, v.get("website"))

        put(ws, row, 55, TIER_LABELS.get(c["prior_tier"]) if c["prior_tier"] else None)
        if c["prior_tier"] is not None:
            put(ws, row, 56, "Yes" if c["prior_tier"] == c["tier"] else "No")

    _proof_block(ws, len(companies))


def _proof_block(ws, count):
    """Corrected ranges starting at the FIRST data row, and no compensating
    constants. The source's counts began one row below the data and a
    hard-coded +1 concealed it."""
    first = MATRIX_FIRST_DATA_ROW
    last = MATRIX_FIRST_DATA_ROW + count - 1
    tier_col = get_column_letter(2)
    exch_col = get_column_letter(5)
    name_col = get_column_letter(4)

    top = last + 3
    _header(ws, top, 2, "Proof totals", GROUP_FILL)
    put(ws, top, 3, "These recompute live. Ranges start at row %d, the first data row." % first)

    r = top + 1
    _header(ws, r, 2, "Companies")
    put(ws, r, 3, '=COUNTA({c}{f}:{c}{l})'.format(c=name_col, f=first, l=last), formula=True)
    r += 1

    for label in ("Tier 1", "Tier 2", "Tier 3", "Tier 4", "Tier 5", "Tier 6", "Unclassified"):
        _header(ws, r, 2, label)
        put(ws, r, 3,
            '=COUNTIF({c}{f}:{c}{l},"{lab}")'.format(c=tier_col, f=first, l=last, lab=label),
            formula=True)
        r += 1
    _header(ws, r, 2, "Tier total")
    put(ws, r, 3, '=SUM(C{a}:C{b})'.format(a=top + 2, b=r - 1), formula=True)
    tier_total_row = r
    r += 2

    for label in ("TSX", "TSXV"):
        _header(ws, r, 2, label)
        put(ws, r, 3,
            '=COUNTIF({c}{f}:{c}{l},"{lab}")'.format(c=exch_col, f=first, l=last, lab=label),
            formula=True)
        r += 1
    _header(ws, r, 2, "Exchange total")
    put(ws, r, 3, '=SUM(C{a}:C{b})'.format(a=r - 2, b=r - 1), formula=True)
    r += 2

    _header(ws, r, 2, "Reconciles?")
    put(ws, r, 3,
        '=IF(AND(C{t}=C{p},C{e}=C{p}),"TIES","DOES NOT TIE")'.format(
            t=tier_total_row, e=r - 1, p=top + 1),
        formula=True)


def _consolidated(wb, data):
    ws = wb.create_sheet("B.01 Consol TSX - TSXV")
    headers = {2: "#", 3: "Ticker", 4: "Name", 5: "Exchange",
               6: "Market Capitalization\n(CAD $)", 7: "HO Location", 8: "HO Region",
               9: "Royalty / Streaming"}
    for i, region in enumerate(REGION_COLUMNS):
        headers[10 + i] = region
    # Column 18 is the unnamed spacer present in the source. It is reproduced so
    # column letters stay stable for anyone holding a downstream reference.
    headers[19] = "Properties in Canada?"
    headers[20] = "Properties Abroad?"
    for col, label in headers.items():
        _header(ws, 7, col, label)
    ws.column_dimensions["D"].width = 34

    # Exchange-then-name order, preserved: the source stores two alphabetical blocks.
    ordered = sorted(data["companies"],
                     key=lambda c: ((c["values"].get("exchange") or ""), c["name"]))
    for n, c in enumerate(ordered, start=1):
        row = 7 + n
        v = c["values"]
        put(ws, row, 2, n)
        put(ws, row, 3, v.get("root_ticker"))
        put(ws, row, 4, c["name"])
        put(ws, row, 5, v.get("exchange"))
        put(ws, row, 6, v.get("market_cap_cad"), number_format="#,##0.00")
        put(ws, row, 7, v.get("head_office_location"))
        put(ws, row, 8, v.get("head_office_region"))
        put(ws, row, 9, "Y" if "royalty_streaming" in c["stages"] else None)
        regions = v.get("property_regions") or {}
        for i, region in enumerate(REGION_COLUMNS):
            vals = regions.get(region) or []
            put(ws, row, 10 + i, ", ".join(vals) if vals else None)
        put(ws, row, 19, "Yes" if (regions.get("CANADA") or []) else "No")
        put(ws, row, 20,
            "Yes" if any(regions.get(a) for a in ABROAD_COLUMNS) else "No")


def _auditor(wb, data):
    ws = wb.create_sheet("B.04 Auditor & Fees")
    headers = {2: "#", 3: "Company", 4: "Entity ID (S&P)", 5: "Big 4 Firms", 6: "Others",
               7: "Audit_Currency", 8: "Audit_Fees", 9: "Audit_Fiscal Year",
               10: "Tax_Currency", 11: "Tax_Fees", 12: "Tax_Fiscal Year", 13: "Website"}
    for col, label in headers.items():
        _header(ws, 5, col, label)
    ws.column_dimensions["C"].width = 34
    ws.column_dimensions["M"].width = 40

    for n, c in enumerate(data["companies"], start=1):
        row = 5 + n
        put(ws, row, 2, n)
        put(ws, row, 3, c["name"])
        put(ws, row, 4, c["entity_id"])
        put(ws, row, 5, c["values"].get("auditor"))
        # Fee columns: headers and formats written, no data. They are in-scope
        # enrichment targets and omitting the columns would break the client's
        # downstream column mapping.
        for col in (8, 11):
            ws.cell(row=row, column=col).number_format = "#,##0.00"
        put(ws, row, 13, c["values"].get("website"))


def _provenance(wb, data):
    ws = wb.create_sheet("Provenance")
    ws.column_dimensions["B"].width = 30
    ws.column_dimensions["C"].width = 96
    p = data["period"]
    rows = [
        ("Period", p["label"]),
        ("Market cap as of", p["market_cap_as_of"]),
        ("Source file SHA-256", data["provenance"]["source_file_sha256"] or "not recorded"),
        ("Rule set version", data["provenance"]["rule_set_version"]),
        ("Companies exported", len(data["companies"])),
        ("Prior period", data["provenance"]["prior_period"] or "none"),
        ("Fee FX rates used", "none - no fee data in this period"),
        ("Enrichment run", "none - this period was not enriched"),
    ]
    _header(ws, 2, 2, "Provenance", GROUP_FILL)
    r = 4
    for label, value in rows:
        _header(ws, r, 2, label)
        put(ws, r, 3, value)
        r += 1
    r += 1
    _header(ws, r, 2, "Licence"); r += 1
    put(ws, r, 2, EXCHANGE_NOTICE); r += 1
    put(ws, r, 2, VENDOR_NOTICE)


# -------------------------------------------------------------- flat export

FLAT_COLUMNS = [
    "ticker", "exchange", "company", "market_cap_cad", "tier", "tier_status",
    "footprint", "rule_set_version", "stages", "regions", "auditor", "entity_id",
    "website", "prior_tier", "period", "as_of",
]


def flat_rows(data: Dict[str, Any]) -> List[OrderedDict]:
    p = data["period"]
    out = []
    for c in data["companies"]:
        v = c["values"]
        regions = v.get("property_regions") or {}
        out.append(OrderedDict([
            ("ticker", v.get("root_ticker")),
            ("exchange", v.get("exchange")),
            ("company", c["name"]),
            ("market_cap_cad", v.get("market_cap_cad")),
            ("tier", c["tier"]),
            ("tier_status", c["status"]),
            ("footprint", c["footprint"]),
            ("rule_set_version", c["rule_set_version"]),
            ("stages", "; ".join(sorted(c["stages"]))),
            ("regions", "; ".join(
                "%s: %s" % (k, ", ".join(regions[k])) for k in sorted(regions) if regions[k])),
            ("auditor", v.get("auditor")),
            ("entity_id", c["entity_id"]),
            ("website", v.get("website")),
            ("prior_tier", c["prior_tier"]),
            ("period", p["label"]),
            ("as_of", p["market_cap_as_of"]),
        ]))
    return out


def write_flat_csv(data: Dict[str, Any], path: str) -> str:
    """Same injection guard as the workbook, same notices in the header."""
    from .xlsxwrite import needs_quote_prefix, sanitize
    with open(path, "w", newline="", encoding="utf-8") as fh:
        fh.write("# %s\n# %s\n# %s\n" % (INTERNAL_USE, EXCHANGE_NOTICE, VENDOR_NOTICE))
        writer = csv.DictWriter(fh, fieldnames=FLAT_COLUMNS)
        writer.writeheader()
        for row in flat_rows(data):
            safe = {}
            for k, val in row.items():
                val = sanitize(val)
                # A CSV opened in Excel evaluates the same prefixes, and there
                # is no quote-prefix flag to lean on -- so here the leading
                # character genuinely has to be neutralised.
                if needs_quote_prefix(val):
                    val = "'" + val
                safe[k] = val
            writer.writerow(safe)
    return path


def export_period(db_path: str, xlsx_path: str,
                  csv_path: Optional[str] = None,
                  label: Optional[str] = None) -> Dict[str, Any]:
    data = read_period(db_path, label)
    wb = build_workbook(data)
    wb.save(xlsx_path)
    if csv_path:
        write_flat_csv(data, csv_path)
    return {"companies": len(data["companies"]),
            "period": data["period"]["label"],
            "xlsx": xlsx_path, "csv": csv_path}


def _money(value):
    try:
        return "{:,.0f}".format(float(value))
    except (TypeError, ValueError):
        return str(value)

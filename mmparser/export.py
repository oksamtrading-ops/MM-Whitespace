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
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
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

# --- how it looks ---------------------------------------------------------
# The application's own palette (src/app/globals.css): Deloitte green for
# marks and fills, never for text; ink for type. A spreadsheet is read across
# a row, so the work here is mostly separating one row from the next and
# making a number say what it is.
INK = "53565A"
HEADER_FILL = PatternFill("solid", fgColor="E7F0D9")   # soft green ground
GROUP_FILL = PatternFill("solid", fgColor="53565A")    # ink band, white type
BAND_FILL = PatternFill("solid", fgColor="F7F7F5")     # every other row
BOLD = Font(bold=True)
GROUP_FONT = Font(bold=True, color="FFFFFF")
WRAP = Alignment(wrap_text=True, vertical="top")
RIGHT = Alignment(horizontal="right", vertical="top")
RULE = Side(style="thin", color="D0D0CE")
HEADER_RULE = Side(style="medium", color="86BC25")     # the brand's one line
HEADER_BORDER = Border(bottom=HEADER_RULE)
CELL_BORDER = Border(bottom=RULE)

#: A tier is a conclusion, so it reads as one: filled, and never colour alone.
TIER_FILLS = {
    1: PatternFill("solid", fgColor="86BC25"),
    2: PatternFill("solid", fgColor="A7CF5E"),
    3: PatternFill("solid", fgColor="C6E29A"),
    4: PatternFill("solid", fgColor="DCEBC3"),
    5: PatternFill("solid", fgColor="EAF3DC"),
    6: PatternFill("solid", fgColor="F4F8EE"),
}

#: Written into the cell so an amount says which dollar it is, the way the
#: application does. An unknown currency is formatted as a plain number
#: rather than guessed at.
CURRENCY_FORMATS = {
    "CAD": '"C$"#,##0', "USD": '"US$"#,##0', "AUD": '"A$"#,##0',
    "GBP": '"£"#,##0', "EUR": '"€"#,##0',
}
PLAIN_MONEY = "#,##0"

BIG_FOUR = {"Deloitte", "PwC", "KPMG", "Ernst & Young"}

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


def money(value) -> Optional[float]:
    """The amount out of a fee, whichever shape it is stored in.

    Fees were bare numbers until currency was kept with them (September 2026);
    both forms are in the published record, so both are read here.
    """
    if isinstance(value, dict):
        amount = value.get("amount")
        return amount if isinstance(amount, (int, float)) else None
    return value if isinstance(value, (int, float)) else None


def currency_of(value) -> Optional[str]:
    return (value.get("currency") or None) if isinstance(value, dict) else None


def fiscal_year_of(value) -> Optional[int]:
    return value.get("fiscal_year") if isinstance(value, dict) else None


def money_format(currency: Optional[str]) -> str:
    return CURRENCY_FORMATS.get((currency or "").upper(), PLAIN_MONEY)


def put_fee(ws, row, columns, value, as_of: Optional[str] = None):
    """Currency, amount, amount in CAD, fiscal year -- the four fee columns.

    The CAD column is filled only where no conversion is needed. There is no
    FX table in this build and docs/design/10 forbids a nearest-date fallback,
    so a foreign fee leaves the cell empty with a comment naming what is
    missing, rather than carrying a rate nobody chose.
    """
    currency_col, amount_col, cad_col, year_col = columns
    amount = money(value)
    currency = currency_of(value)
    put(ws, row, currency_col, currency)
    put(ws, row, amount_col, amount, number_format=money_format(currency))
    if cad_col is None:
        pass
    elif amount is not None and (currency or "").upper() == "CAD":
        put(ws, row, cad_col, amount, number_format=CURRENCY_FORMATS["CAD"])
    elif amount is not None:
        put(ws, row, cad_col, None,
            comment="No conversion: this build holds no FX table, so a %s amount%s is left "
                    "unconverted rather than carrying a rate nobody chose."
                    % (currency or "foreign-currency", " as at %s" % as_of if as_of else ""))
    put(ws, row, year_col, fiscal_year_of(value))


def finish_sheet(ws, *, header_row: int, first_data_row: int, last_data_row: int,
                 last_column: int, widths: Optional[Dict[int, float]] = None,
                 freeze_column: int = 1, tab_color: Optional[str] = None,
                 landscape: bool = True):
    """The treatment every data sheet gets, once, in one place.

    Header rule and fill, banded rows, a filter over the data, frozen panes,
    column widths, and a print setup that survives contact with a printer:
    landscape, fitted to one page wide, header rows repeating on every page,
    and the period in the footer.
    """
    for col in range(1, last_column + 1):
        cell = ws.cell(row=header_row, column=col)
        cell.border = HEADER_BORDER
    if last_data_row >= first_data_row:
        for row in range(first_data_row, last_data_row + 1):
            for col in range(1, last_column + 1):
                cell = ws.cell(row=row, column=col)
                cell.border = CELL_BORDER
                if (row - first_data_row) % 2 == 1:
                    cell.fill = BAND_FILL
        ws.auto_filter.ref = "%s%d:%s%d" % (
            get_column_letter(2), header_row, get_column_letter(last_column), last_data_row)
    for col, width in (widths or {}).items():
        ws.column_dimensions[get_column_letter(col)].width = width
    ws.freeze_panes = ws.cell(row=first_data_row, column=freeze_column)
    if tab_color:
        ws.sheet_properties.tabColor = tab_color

    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "%d:%d" % (header_row, header_row)
    ws.print_options.horizontalCentered = True


def build_workbook(data: Dict[str, Any]) -> Workbook:
    wb = Workbook()
    wb.remove(wb.active)
    _cover(wb, data)
    _summary(wb, data)
    # No divider tabs. The source has two, empty, because ITS table of contents
    # links to them; this file has a Contents sheet that says what each tab
    # holds, and a tab with nothing in it is a defect rather than a section.
    _contents(wb, data)
    _matrix(wb, data)
    _consolidated(wb, data)
    _auditor(wb, data)
    _provenance(wb, data)
    return wb


def _summary(wb, data):
    """One page a partner will actually read.

    Nobody reads 259 rows. This says how big the population is, how much of it
    Deloitte does not audit -- which IS the whitespace -- where the tiers sit,
    and which large companies are unaudited by the firm, largest first.

    The count tables are LIVE formulas over the matrix, like the proof block:
    someone who corrects a tier on that sheet sees this page move with it. The
    table of largest companies is values, because it is a ranking at a moment.
    """
    ws = wb.create_sheet("Summary")
    companies = data["companies"]
    n = len(companies)
    first, last = MATRIX_FIRST_DATA_ROW, MATRIX_FIRST_DATA_ROW + max(n, 1) - 1
    M = "'A.02 Matrix'!"
    tier_col = "$%s$%d:$%s$%d" % (get_column_letter(2), first, get_column_letter(2), last)
    big4_col = "$%s$%d:$%s$%d" % (get_column_letter(37), first, get_column_letter(37), last)
    other_col = "$%s$%d:$%s$%d" % (get_column_letter(38), first, get_column_letter(38), last)
    cap_col = "$%s$%d:$%s$%d" % (get_column_letter(6), first, get_column_letter(6), last)
    foot_col = "$%s$%d:$%s$%d" % (get_column_letter(21), first, get_column_letter(21), last)
    name_col = "$%s$%d:$%s$%d" % (get_column_letter(4), first, get_column_letter(4), last)

    ws.column_dimensions["B"].width = 34
    ws.column_dimensions["C"].width = 14
    ws.column_dimensions["D"].width = 12
    ws.column_dimensions["E"].width = 20
    ws.column_dimensions["F"].width = 22
    ws.column_dimensions["G"].width = 18
    ws.sheet_properties.tabColor = "86BC25"
    ws.page_setup.orientation = "portrait"
    ws.print_options.horizontalCentered = True

    title = put(ws, 2, 2, "Where the whitespace is")
    title.font = Font(bold=True, size=16)
    for col in (2, 3, 4, 5, 6, 7):
        ws.cell(row=2, column=col).border = HEADER_BORDER
    put(ws, 3, 2, "%s - %d companies at or above the threshold. Deloitte's audit relationships "
                  "are not stored in this build, so \"not audited by Deloitte\" is read from the "
                  "auditor named in each company's own filings." % (data["period"]["label"], n))

    row = 5
    _header(ws, row, 2, "The population"); _header(ws, row, 3, "Companies")
    _header(ws, row, 4, "Share"); _header(ws, row, 5, "Market cap (CAD)")
    row += 1
    # Every share on this page is a share OF THE POPULATION, so they all
    # divide by the one cell that holds it -- the first row written below.
    total_row = row

    def count_row(label, formula, cap_formula=None, indent=False):
        nonlocal row
        put(ws, row, 2, ("    " + label) if indent else label)
        put(ws, row, 3, formula, formula=True)
        put(ws, row, 4, '=IF($C$%d=0,"",C%d/$C$%d)' % (total_row, row, total_row),
            formula=True).number_format = "0.0%"
        if cap_formula:
            put(ws, row, 5, cap_formula, formula=True).number_format = CURRENCY_FORMATS["CAD"]
        for col in range(2, 6):
            ws.cell(row=row, column=col).border = CELL_BORDER
        row += 1

    count_row("Every company in the period",
              '=COUNTA(%s%s)' % (M, name_col), '=SUM(%s%s)' % (M, cap_col))
    count_row("Audited by Deloitte",
              '=COUNTIF(%s%s,"Deloitte")' % (M, big4_col),
              '=SUMIF(%s%s,"Deloitte",%s%s)' % (M, big4_col, M, cap_col))
    count_row("NOT audited by Deloitte - the whitespace",
              '=COUNTA(%s%s)-COUNTIF(%s%s,"Deloitte")' % (M, name_col, M, big4_col),
              '=SUM(%s%s)-SUMIF(%s%s,"Deloitte",%s%s)' % (M, cap_col, M, big4_col, M, cap_col))
    count_row("of which another Big 4 firm audits",
              '=COUNTA(%s%s)-COUNTIF(%s%s,"Deloitte")' % (M, big4_col, M, big4_col), indent=True)
    count_row("of which a firm outside the Big 4 audits",
              '=COUNTA(%s%s)' % (M, other_col), indent=True)
    count_row("of which the auditor is not yet known",
              '=COUNTA(%s%s)-COUNTA(%s%s)-COUNTA(%s%s)' % (M, name_col, M, big4_col, M, other_col),
              indent=True)

    row += 1
    _header(ws, row, 2, "Tier"); _header(ws, row, 3, "Companies")
    _header(ws, row, 4, "Share"); _header(ws, row, 5, "Market cap (CAD)")
    row += 1
    for label in ("Tier 1", "Tier 2", "Tier 3", "Tier 4", "Tier 5", "Tier 6", "Unclassified"):
        count_row(label, '=COUNTIF(%s%s,"%s")' % (M, tier_col, label),
                  '=SUMIF(%s%s,"%s",%s%s)' % (M, tier_col, label, M, cap_col))

    row += 1
    _header(ws, row, 2, "Footprint"); _header(ws, row, 3, "Companies"); _header(ws, row, 4, "Share")
    row += 1
    for label in ("Canada only", "Canada & Abroad", "Abroad", "None"):
        count_row(label, '=COUNTIF(%s%s,"%s")' % (M, foot_col, label))

    # The ranking a partner opens this for: the biggest companies the firm
    # does not audit. A value list, because it is this period's order.
    row += 1
    _header(ws, row, 2, "Largest companies Deloitte does not audit")
    _header(ws, row, 3, "Tier"); _header(ws, row, 4, "Exchange")
    _header(ws, row, 5, "Market cap (CAD)"); _header(ws, row, 6, "Auditor")
    _header(ws, row, 7, "Audit fee")
    row += 1
    ranked = sorted(
        (c for c in companies if c["values"].get("auditor") != "Deloitte"),
        key=lambda c: c["values"].get("market_cap_cad") or 0, reverse=True)[:10]
    for c in ranked:
        v = c["values"]
        put(ws, row, 2, c["name"])
        put(ws, row, 3, TIER_LABELS.get(c["tier"]) or STATUS_LABELS.get(c["status"], "Unclassified"))
        put(ws, row, 4, v.get("exchange"))
        put(ws, row, 5, v.get("market_cap_cad"), number_format=CURRENCY_FORMATS["CAD"])
        put(ws, row, 6, v.get("auditor") or "not yet known")
        put(ws, row, 7, money(v.get("audit_fee")),
            number_format=money_format(currency_of(v.get("audit_fee"))))
        for col in range(2, 8):
            ws.cell(row=row, column=col).border = CELL_BORDER
        row += 1
    if not ranked:
        put(ws, row, 2, "Every company in this period is audited by Deloitte.")
        row += 1

    row += 1
    put(ws, row, 2, "What is still missing").font = BOLD
    row += 1
    unresearched = sum(1 for c in companies if not c["stages"])
    no_auditor = sum(1 for c in companies if not c["values"].get("auditor"))
    no_fee = sum(1 for c in companies if money(c["values"].get("audit_fee")) is None)
    put(ws, row, 2,
        "%d companies have no stage researched, so they carry no tier; %d have no auditor on "
        "record; %d have no audit fee. Those are the gaps the research fills, and the charts "
        "on the dashboard stay off until each clears its floor."
        % (unresearched, no_auditor, no_fee)).alignment = WRAP
    ws.freeze_panes = ws.cell(row=5, column=2)


def _contents(wb, data):
    ws = wb.create_sheet("Contents")
    n = len(data["companies"])
    ws.column_dimensions["B"].width = 26
    ws.column_dimensions["C"].width = 86
    put(ws, 2, 2, "Contents").font = Font(bold=True, size=14)
    _header(ws, 4, 2, "Sheet")
    _header(ws, 4, 3, "What is on it")
    rows = [
        ("Cover", "The period, the threshold that defined the population, the publication "
                  "it was taken from, and both licence notices."),
        ("Summary", "One page: how much of the population Deloitte does not audit, the tier "
                    "and footprint split, the largest companies the firm does not audit, and "
                    "what research is still missing."),
        ("A.02 Matrix", "Every company in the period, one row each: tier, market cap, head "
                        "office, stage, properties, auditor and fees. %d rows." % n),
        ("B.01 Consol TSX - TSXV", "The same population in exchange-then-name order, as the "
                                   "consolidated list the practice works from."),
        ("B.04 Auditor & Fees", "Auditor and fee detail, one row per company, with the entity "
                                "identifier where it is known."),
        ("Provenance", "Where this file came from: source workbook hash, rule set, "
                       "enrichment run and the conversion rates used."),
    ]
    for i, (sheet, what) in enumerate(rows):
        put(ws, 5 + i, 2, sheet)
        put(ws, 5 + i, 3, what).alignment = WRAP
        ws.cell(row=5 + i, column=2).border = CELL_BORDER
        ws.cell(row=5 + i, column=3).border = CELL_BORDER
    put(ws, 5 + len(rows) + 1, 2, "Tier is a value, not a formula")
    put(ws, 5 + len(rows) + 1, 3,
        "Tiers are computed and tested in the application and written here as values, with the "
        "rule that produced each one as a comment on the cell. The footprint trio and the proof "
        "totals stay live formulas, with corrected ranges.").alignment = WRAP
    ws.sheet_properties.tabColor = "86BC25"


def _cover(wb, data):
    ws = wb.create_sheet("Cover")
    p = data["period"]
    ws.column_dimensions["B"].width = 34
    ws.column_dimensions["C"].width = 92

    title = put(ws, 2, 2, "Mining Whitespace Analysis")
    title.font = Font(bold=True, size=16)
    for col in (2, 3):
        ws.cell(row=2, column=col).border = HEADER_BORDER
    ws.sheet_properties.tabColor = "53565A"
    ws.page_setup.orientation = "portrait"
    ws.print_options.horizontalCentered = True
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
        _header(ws, MATRIX_GROUP_ROW, col, label, GROUP_FILL).font = GROUP_FONT

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
        tier_cell = put(ws, row, 2, label, comment=trace_note)
        if c["tier"] in TIER_FILLS:
            tier_cell.fill = TIER_FILLS[c["tier"]]
            tier_cell.font = BOLD

        put(ws, row, 3, n)                       # presentation only, never an identity key
        put(ws, row, 4, c["name"])
        put(ws, row, 5, v.get("exchange"))
        put(ws, row, 6, v.get("market_cap_cad"), number_format=CURRENCY_FORMATS["CAD"])
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

        # The two auditor columns are Big 4 and everyone else, and writing every
        # firm into the first made the second look like a column with no data.
        auditor = v.get("auditor")
        put(ws, row, 37 if auditor in BIG_FOUR else 38, auditor)

        as_of = data["period"].get("market_cap_as_of")
        put_fee(ws, row, (40, 41, 42, 43), v.get("audit_fee"), as_of)
        put_fee(ws, row, (45, 46, 47, 48), v.get("tax_fee"), as_of)
        audit_amount, tax_amount = money(v.get("audit_fee")), money(v.get("tax_fee"))
        if audit_amount and tax_amount is not None:
            # Tax as a share of audit, live, so an edited fee updates it.
            put(ws, row, 49, "=IF(%s%d=0,\"\",%s%d/%s%d)" % (
                get_column_letter(41), row, get_column_letter(46), row,
                get_column_letter(41), row), formula=True)
            ws.cell(row=row, column=49).number_format = "0.0%"

        put(ws, row, 51, v.get("website"))

        put(ws, row, 55, TIER_LABELS.get(c["prior_tier"]) if c["prior_tier"] else None)
        if c["prior_tier"] is not None:
            put(ws, row, 56, "Yes" if c["prior_tier"] == c["tier"] else "No")

    finish_sheet(
        ws, header_row=MATRIX_HEADER_ROW, first_data_row=MATRIX_FIRST_DATA_ROW,
        last_data_row=MATRIX_FIRST_DATA_ROW + len(companies) - 1, last_column=56,
        widths={2: 13, 3: 5, 4: 36, 5: 11, 6: 18, 13: 22, 14: 16, 21: 18, 22: 16, 23: 16,
                37: 18, 38: 18, 40: 10, 41: 15, 42: 15, 43: 11,
                45: 10, 46: 15, 47: 15, 48: 11, 49: 9, 51: 40, 55: 10, 56: 8},
        freeze_column=5, tab_color="86BC25")
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
        put(ws, row, 6, v.get("market_cap_cad"), number_format=CURRENCY_FORMATS["CAD"])
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

    finish_sheet(ws, header_row=7, first_data_row=8, last_data_row=7 + len(ordered),
                 last_column=20,
                 widths={2: 5, 3: 10, 4: 36, 5: 11, 6: 20, 7: 22, 8: 24, 9: 14,
                         19: 18, 20: 18},
                 freeze_column=5, tab_color="A7CF5E")


def _auditor(wb, data):
    ws = wb.create_sheet("B.04 Auditor & Fees")
    headers = {2: "#", 3: "Company", 4: "Entity ID (S&P)", 5: "Big 4 Firms", 6: "Others",
               7: "Audit_Currency", 8: "Audit_Fees", 9: "Audit_Fiscal Year",
               10: "Tax_Currency", 11: "Tax_Fees", 12: "Tax_Fiscal Year", 13: "Website"}
    for col, label in headers.items():
        _header(ws, 5, col, label)

    as_of = data["period"].get("market_cap_as_of")
    for n, c in enumerate(data["companies"], start=1):
        row = 5 + n
        v = c["values"]
        put(ws, row, 2, n)
        put(ws, row, 3, c["name"])
        put(ws, row, 4, c["entity_id"])
        auditor = v.get("auditor")
        put(ws, row, 5 if auditor in BIG_FOUR else 6, auditor)
        # Fees, in the currency the filing states them in, for the year it
        # states them for. Blank where nothing has been accepted yet.
        put_fee(ws, row, (7, 8, None, 9), v.get("audit_fee"), as_of)
        put_fee(ws, row, (10, 11, None, 12), v.get("tax_fee"), as_of)
        put(ws, row, 13, v.get("website"))

    finish_sheet(ws, header_row=5, first_data_row=6,
                 last_data_row=5 + len(data["companies"]), last_column=13,
                 widths={2: 5, 3: 36, 4: 16, 5: 18, 6: 18, 7: 12, 8: 16, 9: 12,
                         10: 12, 11: 16, 12: 12, 13: 40},
                 freeze_column=4, tab_color="C6E29A")


def _fee_line(data) -> str:
    """What the fee columns hold, so their emptiness is never a mystery."""
    fees = [(c["values"].get("audit_fee"), c["values"].get("tax_fee")) for c in data["companies"]]
    have = [f for pair in fees for f in pair if money(f) is not None]
    if not have:
        return ("none accepted yet - the columns are written for the population and fill as "
                "fees are researched and accepted")
    currencies = sorted({(currency_of(f) or "currency not recorded") for f in have})
    return "%d amounts across %d companies, in %s" % (
        len(have),
        sum(1 for a, t in fees if money(a) is not None or money(t) is not None),
        ", ".join(currencies))


def _fx_line(data) -> str:
    """No FX table exists in this build, and docs/design/10 forbids guessing."""
    foreign = {(currency_of(f) or "").upper()
               for c in data["companies"] for f in (c["values"].get("audit_fee"),
                                                    c["values"].get("tax_fee"))
               if money(f) is not None and (currency_of(f) or "CAD").upper() != "CAD"}
    if not foreign:
        return "none needed - every fee recorded is already in Canadian dollars"
    return ("none - %s amounts are left unconverted rather than carrying a rate nobody chose; "
            "the CAD column names what is missing" % ", ".join(sorted(foreign)))


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
        ("Fee FX rates used", _fx_line(data)),
        ("Fees in this period", _fee_line(data)),
        ("Enrichment run", "none - this period was not enriched"),
    ]
    _header(ws, 2, 2, "Provenance", GROUP_FILL).font = GROUP_FONT
    ws.sheet_properties.tabColor = "53565A"
    ws.page_setup.orientation = "portrait"
    ws.print_options.horizontalCentered = True
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

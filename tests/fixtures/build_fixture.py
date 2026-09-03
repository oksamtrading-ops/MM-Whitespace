"""Build a synthesised structural derivative of the whitespace workbook.

The real workbook carries personal data and two third-party licences, so it can
never be committed as a fixture (docs/design/13-testing-strategy.md). This
fabricates company data while reproducing every structural pathology the parser
has to survive:

  * 13 sheets, two of them visible empty dividers
  * group row + header row, with four header names duplicated across the two
    fee blocks
  * headers carrying newlines, leading and trailing spaces, and embedded dates
  * the same concept spelled differently on the two extract tabs
  * six missing-value forms including numeric zero and trailing-space variants
  * a live autofilter whose criterion hides sub-threshold rows
  * a region value present in the consolidated list and absent from the extract
  * a cell beginning with "@"
  * a Deloitte-client column, which must be positively excluded

Run:  python3 tests/fixtures/build_fixture.py
"""
from __future__ import annotations

import os

from openpyxl import Workbook
from openpyxl.worksheet.filters import CustomFilter, CustomFilters, FilterColumn

OUT = os.path.join(os.path.dirname(__file__), "synthetic_whitespace.xlsx")

# ticker, name, exchange, mcap, expl, dev, prod, roy, canada, abroad, auditor4, auditorO
COMPANIES = [
    ("NRTH", "Northco Mining Corp.",   "TSX",  5_000_000_000, "", "", "X", "",  "ON",  "Peru",      "Deloitte ",          None),
    ("STHC", "Southco Resources Ltd.", "TSX",  3_200_000_000, "", "", "X", "",  "BC",  "",          "PwC",                 "Not found"),
    ("EAST", "Eastco Gold Inc.",       "TSXV",   900_000_000, "", "", "X", "",  "",    "Mexico",    "KPMG",                0),
    ("ROYL", "Royalco Streaming Inc.", "TSX",  8_400_000_000, "", "", "",  "X", "",    "",          "EY (Ernst & Young)",  None),
    ("DEVL", "Devco Development Ltd.", "TSXV",   450_000_000, "", "X", "", "",  "SK",  "",          "Other",               "Grant Thornton "),
    ("EXPL", "Expco Exploration Ltd.", "TSXV",   260_000_000, "X", "", "", "", "YT",  "",          "Other ",              "Grant Thornton"),
    ("BLNK", "Blankco Holdings Inc.",  "TSX",    780_000_000, "", "", "",  "",  "QC",  "",          "Not found",           "Not found"),
    ("CARY", "Carryco Minerals Inc.",  "TSXV",   310_000_000, "", "X", "", "",  "",    "",          "N/A",                 "MNP"),
]
# Carryco's region exists in the consolidated list only -- the carry-forward case.
CONSOLIDATED_ONLY = {"CARY": ("CANADA", "NT")}
# Rows below the filter threshold, hidden in the source, which must still be read.
SUB_THRESHOLD = [
    ("TINY", "Tinyco Prospect Ltd.", "TSX",   120_000_000),
    ("SMAL", "Smallco Claims Inc.",  "TSXV",   45_000_000),
]

REGIONS = ["AFRICA", "ASIA", "AUS/NZ/PNG", "CANADA", "LATIN AMERICA", "OTHER", "UK/EUROPE", "USA"]


def _region_cells(canada, abroad):
    """Map a company's canada/abroad values onto the eight region columns."""
    cells = {r: None for r in REGIONS}
    if canada:
        cells["CANADA"] = canada
    if abroad:
        cells["LATIN AMERICA" if abroad in ("Peru", "Mexico") else "AFRICA"] = abroad
    return cells


def build():
    wb = Workbook()
    wb.remove(wb.active)

    wb.create_sheet("Cover")["B2"] = "M&M Whitespace Analysis -- SYNTHETIC FIXTURE"
    ins = wb.create_sheet("Instructions")
    for i, step in enumerate(["Step 1", "Step 2", "Step 3", "Step 5"], start=2):
        ins.cell(row=i, column=2, value=step)          # step 4 is missing, as in the real file

    wb.create_sheet("A - Analysis >>")                  # visible empty divider

    dash = wb.create_sheet("A.01 Dashboard")
    dash["B2"] = "Tier distribution"

    # ---------------------------------------------------------------- matrix
    m = wb.create_sheet("A.02 Matrix")
    groups = {
        2: "Classification", 3: "Company Inputs - TSX/TSXV",
        13: "Management Location - TSX/TSXV Data",
        16: "Stage of Operations (based on S&P Data)",
        21: "Location of Properties",
        25: "Location of Properties in Canada - TSX",
        35: "Deloitte Tax Client",
        37: "Auditor - DisclosureNet",
        40: "Audit Fees -  Avantis platform",
        45: "Tax Fees Paid to Audit Firm - Avantis",
    }
    for col, label in groups.items():
        m.cell(row=4, column=col, value=label)
    headers = {
        2: "Tier", 3: "#", 4: "Company", 5: "Exchange", 6: "Marketcap\n(in CAD)",
        13: "Head Office", 14: "DTT Market",
        16: "Exploration", 17: "Development", 18: "Production", 19: "Royalty / Streaming",
        21: "Canada vs Abroad", 22: "Properties in Canada?", 23: "Properties Abroad?",
        35: "Yes / No",
        37: "Big 4 Firms", 38: "Others",
        # The four duplicated names -- audit block then tax block.
        40: "Currency", 41: "Fees", 42: "Fees in CAD ", 43: "Fiscal Year",
        45: "Currency", 46: "Fees", 47: "Fees in CAD ", 48: "Fiscal Year",
        50: "Company's Website", 52: "Comments",
    }
    for i, name in enumerate(REGIONS):
        headers[25 + i] = name
    for col, label in headers.items():
        m.cell(row=5, column=col, value=label)

    for n, (tk, name, exch, mcap, e, d, p, r, can, abr, a4, ao) in enumerate(COMPANIES, start=1):
        row = 5 + n
        m.cell(row=row, column=2, value="4")            # tier stored as TEXT, as in the source
        m.cell(row=row, column=3, value=n)              # the positional counter
        m.cell(row=row, column=4, value=name)
        m.cell(row=row, column=5, value=exch)
        m.cell(row=row, column=6, value=float(mcap))
        m.cell(row=row, column=13, value="ON")
        m.cell(row=row, column=14, value="Ontario")
        m.cell(row=row, column=16, value=e or None)
        m.cell(row=row, column=17, value=d or None)
        m.cell(row=row, column=18, value=p or None)
        m.cell(row=row, column=19, value=r or None)
        m.cell(row=row, column=35, value="Yes" if n in (1, 3) else None)   # excluded column
        m.cell(row=row, column=37, value=a4)
        m.cell(row=row, column=38, value=ao)
        for i, region in enumerate(REGIONS):
            m.cell(row=row, column=25 + i, value=_region_cells(can, abr)[region])
        # A page title where a URL belongs, and a cell that starts with "@".
        m.cell(row=row, column=50,
               value=("%s | Official Site" % name) if n % 2 else "https://example.invalid/%s" % tk.lower())
        m.cell(row=row, column=52, value="@risk note" if n == 2 else None)

    wb.create_sheet("B - Supporting Schedules >>")       # second visible empty divider

    # ---------------------------------------------------------- consolidated
    c = wb.create_sheet("B.01 Consol TSX - TSXV")
    c["B5"] = "TSX & TSXV Data (From tabs B.02 and B.03)"
    c["J5"] = "Location of Properties (based on TSX Data)"
    chead = {2: "#", 3: "Ticker", 4: "Name", 5: "Exchange",
             6: "Market Capitalization \n(CAD $)", 7: "HO Location", 8: "HO Region",
             9: "Royalty / Streaming", 19: "Properties in Canada?", 20: "Properties Abroad?"}
    for i, name in enumerate(REGIONS):
        chead[10 + i] = name
    for col, label in chead.items():
        c.cell(row=7, column=col, value=label)
    for n, (tk, name, exch, mcap, e, d, p, r, can, abr, a4, ao) in enumerate(COMPANIES, start=1):
        row = 7 + n
        c.cell(row=row, column=2, value=n)
        c.cell(row=row, column=3, value=tk)
        c.cell(row=row, column=4, value=name)
        c.cell(row=row, column=5, value=exch)
        c.cell(row=row, column=6, value=float(mcap))
        c.cell(row=row, column=7, value="ON")
        c.cell(row=row, column=8, value="Canada")
        c.cell(row=row, column=9, value="Y" if r else None)
        cells = _region_cells(can, abr)
        if tk in CONSOLIDATED_ONLY:
            label, value = CONSOLIDATED_ONLY[tk]
            cells[label] = value
        for i, region in enumerate(REGIONS):
            c.cell(row=row, column=10 + i, value=cells[region])

    # -------------------------------------------------------------- extracts
    _extract(wb, "B.02 TSX MM Issuers June 2025", "TSX", tsxv=False)
    _extract(wb, "B.03 TSXV MM Issuers June 2025", "TSXV", tsxv=True)

    # --------------------------------------------------------------- auditor
    a = wb.create_sheet("B.04 Auditor & Fees")
    a["B1"] = "Info from a fee-disclosure platform"
    a["E4"] = "Auditors"
    ahead = {2: "#", 3: "Company", 4: "Entity ID (S&P)", 5: "Big 4 Firms", 6: "Others",
             7: "Audit_Currency", 8: "Audit_Fees", 9: "Audit_Fiscal Year", 13: "Website"}
    for col, label in ahead.items():
        a.cell(row=5, column=col, value=label)
    for n, (tk, name, *_rest) in enumerate(COMPANIES, start=1):
        row = 5 + n
        a.cell(row=row, column=2, value=n)
        a.cell(row=row, column=3, value=name)
        a.cell(row=row, column=4, value=100000 + n if n <= 5 else "Not found")
        a.cell(row=row, column=5, value=COMPANIES[n - 1][10])
        a.cell(row=row, column=6, value=COMPANIES[n - 1][11])

    wb.save(OUT)
    return OUT


def _extract(wb, title, exchange, tsxv):
    ws = wb.create_sheet(title)
    ws["A1"] = "This information is provided for information purposes only"
    ws["A2"] = "and we are not responsible for any errors or omissions."
    ws["A3"] = "(c) 2026 Synthetic Exchange Inc. All Rights Reserved."
    ws["B6"] = "Number of Issuers"
    ws["C6"] = "Total Market Cap (C$)"

    # The same concepts, spelled differently on the two tabs.
    if tsxv:
        head = ["Co_ID", "PO ID", "Exchange", "Name", "Root Ticker",
                "Market Cap (C$) 31-May-2026", "Sub-Sector", "HQ Location", "HQ Region",
                "Interlisted", "CPC/ Former CPC", "Number of Months in Trading Data"]
    else:
        head = ["Co_ID", "Exchange", "Name", "Root\nTicker",
                " Market Cap (C$)\n31-May-2026 ", "Sub\nSector", "HQ\nLocation", "HQ\nRegion",
                "Interlisted I", "TSX \nVenture \nGrad", "Number of\nMonths of \nTrading Data"]
    for i, label in enumerate(head, start=1):
        ws.cell(row=10, column=i, value=label)
    base = len(head)
    for i, name in enumerate(REGIONS):
        ws.cell(row=10, column=base + 1 + i, value=name)
    ws.cell(row=10, column=base + 9, value="Gold")
    ws.cell(row=10, column=base + 10, value="Royalty Streaming")
    ws.cell(row=10, column=base + 11, value="Other Properties")

    tcol = 5 if tsxv else 4
    ecol = 3 if tsxv else 2
    ncol = 4 if tsxv else 3
    mcol = 6 if tsxv else 5

    rows = [(tk, name, mcap, can, abr, r)
            for tk, name, exch, mcap, e, d, p, r, can, abr, a4, ao in COMPANIES
            if exch == exchange]
    rows += [(tk, name, mcap, "", "", "")
             for tk, name, exch, mcap in SUB_THRESHOLD if exch == exchange]

    row = 11
    for tk, name, mcap, can, abr, r in rows:
        ws.cell(row=row, column=ecol, value=exchange)
        ws.cell(row=row, column=ncol, value=name)
        ws.cell(row=row, column=tcol, value=tk)
        ws.cell(row=row, column=mcol, value=float(mcap))
        cells = _region_cells(can, abr)
        if tk in CONSOLIDATED_ONLY:            # absent here, present in consolidated
            cells[CONSOLIDATED_ONLY[tk][0]] = None
        for i, region in enumerate(REGIONS):
            ws.cell(row=row, column=base + 1 + i, value=cells[region])
        ws.cell(row=row, column=base + 10, value="Y" if r else None)
        ws.cell(row=row, column=base + 11, value="Cobalt, Graphite" if tk == "EXPL" else None)
        if mcap < 200_000_000:
            ws.row_dimensions[row].hidden = True
        row += 1

    last_col = base + 11
    from openpyxl.utils import get_column_letter as gl
    ws.auto_filter.ref = "%s10:%s%d" % (gl(ecol), gl(last_col), row - 1)
    fc = FilterColumn(colId=mcol - ecol)
    fc.customFilters = CustomFilters(
        customFilter=[CustomFilter(operator="greaterThanOrEqual", val="200000000")])
    ws.auto_filter.filterColumn.append(fc)
    ws["B8"] = sum(1 for r in rows if r[2] >= 200_000_000)


if __name__ == "__main__":
    print("wrote %s" % build())

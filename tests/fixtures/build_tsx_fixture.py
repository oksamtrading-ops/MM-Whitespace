"""Build a synthetic TSX "List of Mining Companies on TSX & TSXV".

Built at test time, never committed: CI allows exactly one spreadsheet in the
repository (the synthetic whitespace workbook), and TSX's real list carries
TSX Inc.'s copyright. This fabricates the issuers and reproduces the layout of
the real download (September 2026): two sheets, TSX's disclaimer in rows 1-3,
"Number of Issuers" and "Total Market Cap (C$)" printed in row 6 over their
values in row 8, the header in row 10 with the market-cap date written out as
"31-August-2026", and the two exchanges spelling the same columns differently.
"""
from __future__ import annotations

from openpyxl import Workbook

REGIONS = ["AFRICA", "ASIA", "AUS/NZ/PNG", "CANADA", "LATIN AMERICA", "OTHER", "UK/EUROPE", "USA"]

# co_id, ticker, name, market cap, HQ location, HQ region, canada, abroad (bucket, places), gold, copper, other
#
# Against the synthetic whitespace workbook (May 2026), as next quarter's list:
# NRTH, ROYL, EAST and EXPL continue; Southco's ticker has changed (STHC to
# SOCO); Carryco has graduated from TSXV; Devco has fallen under the C$200M
# line; Blankco is not on the list at all. Newco and Edgeco are new, Edgeco
# 1.5% above the line and headquartered in Manitoba, where the practice has no
# market yet. ROYL marks no region, so its last period's regions stand.
TSX = [
    ("C-001", "NRTH", "Northco Mining Corp.", 5_400_000_000, "ON", "Canada", "ON, QC", ("LATIN AMERICA", "Peru"), "Y", "Y", None),
    ("C-002", "ROYL", "Royalco Streaming Inc.", 8_100_000_000, "BC", "Canada", "", None, "Y", "", None),
    ("C-003", "WSTC", "Westco Gold Ltd.", 190_000_000, "NV", "USA", "", ("USA", "NV"), "Y", "", None),
    ("C-004", "SOCO", "Southco Resources Ltd.", 3_100_000_000, "ON", "Canada", "BC", None, "Y", "", None),
    ("C-005", "CARY", "Carryco Minerals Inc.", 520_000_000, "ON", "Canada", "NT", None, "Y", "", None),
    ("C-006", "NEWC", "Newco Copper Corp.", 650_000_000, "BC", "Canada", "BC", None, "", "Y", None),
]
TSXV = [
    ("C-101", "EAST", "Eastco Gold Inc.", 950_000_000, "Chile", "Latin America", "", ("LATIN AMERICA", "Chile"), "Y", "", None),
    ("C-102", "EXPL", "Expco Exploration Ltd.", 240_000_000, "YT", "Canada", "YT", None, "", "", "Cobalt, Graphite"),
    ("C-103", "TINY", "Tinyco Resources Ltd.", 12_000_000, "QC", "Canada", "QC", None, "Y", "", None),
    ("C-104", "EDGE", "Edgeco Metals Inc.", 203_000_000, "MB", "Canada", "MB", None, "Y", "", None),
    ("C-105", "DEVL", "Devco Development Ltd.", 150_000_000, "ON", "Canada", "SK", None, "", "", "Potash"),
]


def _sheet(wb, title, exchange, rows, tsxv):
    ws = wb.create_sheet(title)
    ws["A1"] = "This information is provided for information purposes only."
    ws["A2"] = "and we are not responsible for any errors or omissions."
    ws["A3"] = "(c) 2026 Synthetic Exchange Inc. All Rights Reserved."
    ws["C6"] = "Number of Issuers"
    ws["E6"] = "Total Market Cap (C$)"
    ws["C8"] = len(rows)
    ws["E8"] = float(sum(r[3] for r in rows))
    if tsxv:
        head = ["Co_ID", "PO ID", "Exchange", "Name", "Root Ticker", "Market Cap (C$) 31-August-2026",
                "Sub-Sector", "HQ Location", "HQ Region", "Listing Type", "Listing Date", "Interlisted"]
    else:
        head = ["Co_ID", "Exchange", "Name", "Root Ticker", "Market Cap (C$) 31-August-2026",
                "Sub Sector", "HQ Location", "HQ Region", "Listing Type", "Listing Date", "Interlisted I",
                "TSX  Venture  Grad"]
    head += REGIONS + ["Gold", "Copper", "Royalty Streaming", "Other Properties"]
    for i, label in enumerate(head, start=1):
        ws.cell(row=10, column=i, value=label)
    col = {label: i for i, label in enumerate(head, start=1)}
    for n, (co_id, tk, name, mcap, hq, region, canada, abroad, gold, copper, other) in enumerate(rows):
        r = 11 + n
        ws.cell(row=r, column=col["Co_ID"], value=co_id)
        ws.cell(row=r, column=col["Exchange"], value=exchange)
        ws.cell(row=r, column=col["Name"], value=name)
        ws.cell(row=r, column=col["Root Ticker"], value=tk)
        ws.cell(row=r, column=col["Market Cap (C$) 31-August-2026"], value=float(mcap))
        ws.cell(row=r, column=col["HQ Location"], value=hq)
        ws.cell(row=r, column=col["HQ Region"], value=region)
        ws.cell(row=r, column=col["Listing Type"], value="IPO")
        ws.cell(row=r, column=col["Listing Date"], value=20200101 + n)
        if canada:
            ws.cell(row=r, column=col["CANADA"], value=canada)
        if abroad:
            ws.cell(row=r, column=col[abroad[0]], value=abroad[1])
        ws.cell(row=r, column=col["Gold"], value=gold or None)
        ws.cell(row=r, column=col["Copper"], value=copper or None)
        ws.cell(row=r, column=col["Royalty Streaming"], value="Y" if tk == "ROYL" else None)
        ws.cell(row=r, column=col["Other Properties"], value=other)
        if not tsxv and tk == "NRTH":
            ws.cell(row=r, column=col["TSX  Venture  Grad"], value="Y")
    return ws


def build(path: str) -> str:
    wb = Workbook()
    wb.remove(wb.active)
    _sheet(wb, "TSX MM Issuers August 2026", "TSX", TSX, tsxv=False)
    _sheet(wb, "TSXV MM Issuers August 2026", "TSXV", TSXV, tsxv=True)
    wb.save(path)
    return path


if __name__ == "__main__":
    import sys
    print(build(sys.argv[1]))

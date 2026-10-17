"""TSX's own list of mining issuers, read as the source of next quarter's period.

tsx.com publishes "List of Mining Companies on TSX & TSXV": one sheet per
exchange, every listed mining issuer, with market cap, head office, property
regions and commodity flags. The whitespace workbook's B.02 and B.03 tabs are
copies of it, filtered to the population. This reads the list itself.

It reads EVERY issuer, about 1,075 of them. Which ones form the period is the
application's threshold, a setting it owns, applied before anything is
committed; it is never decided here. Nothing the workbook's own tabs carry
(stages, auditor, website, the Deloitte market) is in this file: the period
inherits those from the last published revision.

Proofs tie the read to TSX's own totals on each sheet -- "Number of Issuers"
and "Total Market Cap (C$)" -- so a sheet half-read cannot pass.
"""
from __future__ import annotations

from collections import OrderedDict
from typing import Dict, List, Optional, Tuple

from .aliases import normalise_head_office
from .safety import Finding

KNOWN_EXCHANGES = {"TSX", "TSXV"}


def _stated_totals(ws) -> Tuple[Optional[int], Optional[float]]:
    """TSX's own count and total market cap, each printed under its label above the header row."""
    def under(label: str):
        for r in range(1, 10):
            for c in range(1, 20):
                if str(ws.cell(row=r, column=c).value or "").strip().lower().startswith(label):
                    for rr in range(r + 1, r + 4):
                        v = ws.cell(row=rr, column=c).value
                        if isinstance(v, (int, float)):
                            return v
                    return None
        return None
    count, total = under("number of issuers"), under("total market cap")
    return (int(count) if count is not None else None, float(total) if total is not None else None)


def ingest_tsx_list(wb, roles, findings: List[Finding]):
    from .ingest import _report, parse_extract

    companies: Dict[tuple, dict] = {}
    totals = OrderedDict()
    for ws, header_row in roles["extract"]:
        rows, meta = parse_extract(ws, header_row, findings)
        stated_count, stated_cap = _stated_totals(ws)
        if stated_count is not None:
            totals["%s: issuers read vs Number of Issuers" % ws.title] = (len(rows), stated_count)
        else:
            findings.append(Finding("warning", "issuer_count_missing",
                                    "%s states no Number of Issuers to check the read against" % ws.title))
        if stated_cap is not None:
            read_cap = sum(r["market_cap"] or 0 for r in rows.values())
            totals["%s: market cap read vs Total Market Cap (C$, to the dollar)" % ws.title] = (
                int(round(read_cap)), int(round(stated_cap)))
        for key, row in rows.items():
            if key in companies:
                findings.append(Finding("blocking", "duplicate_issuer",
                                        "%s on %s appears twice (%s and %s)"
                                        % (key[0], key[1], companies[key]["sheet"], ws.title)))
                continue
            row["sheet"] = ws.title
            companies[key] = row

    header_dates = {r["as_of"] for r in companies.values() if r.get("as_of")}
    period = None
    if len(header_dates) == 1:
        period = next(iter(header_dates))
    elif len(header_dates) > 1:
        findings.append(Finding("blocking", "period_ambiguous",
                                "market-cap headers disagree: %s" % sorted(header_dates)))
    else:
        findings.append(Finding("blocking", "period_unresolvable",
                                "no as-of date captured from any market-cap header"))

    bad = {r["exchange"] for r in companies.values()} - KNOWN_EXCHANGES
    if bad:
        findings.append(Finding("blocking", "exchange_vocabulary", "unknown exchange values: %s" % sorted(bad)))
    for label, (actual, expected) in totals.items():
        if actual != expected:
            findings.append(Finding("blocking", "proof_total", "%s: %s != %s" % (label, actual, expected)))

    out = OrderedDict()
    no_cap = 0
    for key, r in companies.items():
        head_office, problem = normalise_head_office(r.get("ho_location"), r.get("ho_region"))
        if problem:
            findings.append(Finding("warning", "head_office_ambiguous",
                                    "%s (%s): %s; left for research" % (r["name"], r["ticker"], problem)))
        if r["market_cap"] is None:
            no_cap += 1
        out[key] = {
            "ticker": r["ticker"], "exchange": r["exchange"], "name": r["name"],
            "co_id": r.get("co_id"),
            "market_cap": r["market_cap"],
            "regions": r["regions"],
            "region_provenance": {b: "extract" for b, present in r["region_present"].items() if present},
            "commodities": r["commodities"],
            "venture_graduate": r["venture_graduate"],
            "head_office_region": head_office,
            "listing_type": r.get("listing_type"),
            "listing_date": str(r["listing_date"]) if r.get("listing_date") is not None else None,
            "sheet": r["sheet"],
        }
    if no_cap:
        findings.append(Finding("info", "market_cap_missing",
                                "%d issuers carry no market cap, so no threshold can place them" % no_cap))

    proofs = {"totals": totals, "population": len(out), "period": period,
              "exchanges": {e: sum(1 for c in out.values() if c["exchange"] == e) for e in sorted(KNOWN_EXCHANGES)}}
    return out, _report(findings, proofs, {}, period, kind="tsx_list")

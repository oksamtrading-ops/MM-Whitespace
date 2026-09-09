"""Read the workbook into normalised rows and build the validation report.

Nothing is written until an Analyst confirms the report; this module produces
the report and the rows, and decides nothing on its own.
"""
from __future__ import annotations

import warnings
from collections import Counter, OrderedDict
from typing import Dict, List, Optional

warnings.filterwarnings("ignore")
import openpyxl  # noqa: E402

from .aliases import (ABROAD_COLUMNS, COMMODITY_FLAGS, UNNAMED_OTHER,
                      canonical_firm)
from .safety import Finding, inspect_package, scan_for_person_data
from .sentinels import resolve
from .textnorm import clean_text
from .workbook import (EXCLUDED_GROUP_SLUGS, bind_sheets, cell, last_data_row,
                       parse_marker, parse_money, read_columns, split_regions)

REGION_HEADERS = OrderedDict([
    ("africa", "AFRICA"), ("asia", "ASIA"), ("aus nz png", "AUS/NZ/PNG"),
    ("canada", "CANADA"), ("latin america", "LATIN AMERICA"),
    ("other", "OTHER"), ("uk europe", "UK/EUROPE"), ("usa", "USA"),
])
KNOWN_EXCHANGES = {"TSX", "TSXV"}
VALID_TIERS = {1, 2, 3, 4, 5, 6}


# The market field is a constrained enum including an explicit foreign value,
# never free text. Anything outside it fails into the override queue.
DTT_MARKETS = {
    "british columbia": "British Columbia",
    "ontario": "Ontario",
    "quebec & ncr": "Quebec & NCR",
    "quebec and ncr": "Quebec & NCR",
    "prairies region": "Prairies Region",
    "prairie region": "Prairies Region",
    "atlantic": "Atlantic",
}


def _market_value(value, company, findings):
    if not value.present:
        return None
    key = clean_text(value.value).casefold()
    if key in DTT_MARKETS:
        return DTT_MARKETS[key]
    findings.append(Finding(
        "warning", "market_not_in_enum",
        "%s: Deloitte market %r is not one of the five markets -- a country typed "
        "into the market column is a data-entry error, not a market" % (company, value.value)))
    return None


def _norm_name(value: str) -> str:
    text = clean_text(value).casefold().replace("&", " and ")
    for suffix in (" corporation", " corp", " incorporated", " inc", " limited",
                   " ltd", " plc", " company", " co", " nl", " sa", " ag"):
        while text.endswith(suffix):
            text = text[: -len(suffix)]
    return "".join(ch for ch in text if ch.isalnum() or ch == " ").strip()


# --------------------------------------------------------------- extracts

def parse_extract(ws, header_row, findings):
    cols = read_columns(ws, header_row, None, findings)
    ticker_col = cols.require("root ticker")
    if ticker_col is None:
        return {}, None
    last = last_data_row(ws, ticker_col.index, header_row + 1)

    criterion = None
    if ws.auto_filter and ws.auto_filter.ref:
        start_col = openpyxl.utils.range_boundaries(ws.auto_filter.ref)[0]
        for fc in ws.auto_filter.filterColumn:
            if fc.customFilters:
                for f in fc.customFilters.customFilter:
                    letter = openpyxl.utils.get_column_letter(start_col + fc.colId)
                    criterion = {"column": letter, "operator": f.operator, "value": f.val}

    exch_col = cols.get("exchange")
    mcap_col = cols.get("market cap (cad)")
    grad_col = cols.get("tsx venture grad")
    otherprops_col = cols.get("other properties")
    region_cols = {label: cols.get(slug) for slug, label in REGION_HEADERS.items()}
    commodity_cols = {name: cols.get(name.casefold().replace("/", " ").replace("&", "&"))
                      for name in COMMODITY_FLAGS}

    rows, hidden = {}, 0
    for r in range(header_row + 1, last + 1):
        ticker = cell(ws, r, ticker_col)
        if not ticker.present:
            continue
        if ws.row_dimensions[r].hidden:
            hidden += 1
        exch = cell(ws, r, exch_col)
        regions, region_present = {}, {}
        for label, col in region_cols.items():
            v = cell(ws, r, col)
            region_present[label] = v.present
            regions[label] = split_regions(v.value, findings,
                                           "%s row %d %s" % (ws.title, r, label)) if v.present else []
        commodities = [name for name, col in commodity_cols.items()
                       if parse_marker(cell(ws, r, col))]
        free = cell(ws, r, otherprops_col)
        if free.present:
            commodities += [t for t in split_regions(free.value, findings, "other properties")]
        key = (ticker.value.strip().upper(), (exch.value or "").strip().upper())
        rows[key] = {
            "ticker": key[0], "exchange": key[1], "row": r,
            "name": cell(ws, r, cols.get("name")).value,
            "market_cap": parse_money(cell(ws, r, mcap_col)),
            "regions": regions, "region_present": region_present,
            "commodities": sorted(set(commodities)),
            "venture_graduate": parse_marker(cell(ws, r, grad_col)),
            "royalty_flag": parse_marker(cell(ws, r, cols.get("royalty streaming"))),
            "hidden": ws.row_dimensions[r].hidden,
            "as_of": mcap_col.as_of if mcap_col else None,
        }
    return rows, {"criterion": criterion, "hidden": hidden, "total": len(rows),
                  "sheet": ws.title}


# ----------------------------------------------------------- consolidated

def parse_consolidated(ws, header_row, findings):
    cols = read_columns(ws, header_row, header_row - 2, findings)
    ticker_col = cols.require("ticker")
    if ticker_col is None:
        return {}
    last = last_data_row(ws, ticker_col.index, header_row + 1)
    counter_col = _counter_column(ws, cols, "ticker", header_row, last, findings, "consolidated")
    region_cols = {label: cols.get(slug) for slug, label in REGION_HEADERS.items()}

    rows = {}
    for r in range(header_row + 1, last + 1):
        ticker = cell(ws, r, ticker_col)
        if not ticker.present:
            continue
        regions, region_present = {}, {}
        for label, col in region_cols.items():
            v = cell(ws, r, col)
            region_present[label] = v.present
            regions[label] = split_regions(v.value, findings,
                                           "consolidated row %d %s" % (r, label)) if v.present else []
        ordinal = None
        if counter_col is not None:
            ov = cell(ws, r, counter_col)
            ordinal = int(float(ov.value)) if ov.present else None
        rows[r] = {
            "row": r, "ordinal": ordinal,
            "ticker": ticker.value.strip().upper(),
            "name": cell(ws, r, cols.get("name")).value,
            "exchange": (cell(ws, r, cols.get("exchange")).value or "").strip().upper(),
            "market_cap": parse_money(cell(ws, r, cols.get("market cap (cad)"))),
            "regions": regions, "region_present": region_present,
            "royalty_flag": parse_marker(cell(ws, r, cols.get("royalty streaming"))),
        }
    return rows


def _counter_column(ws, cols, anchor_header, header_row, last, findings, where):
    """The '#' counter does not survive slug step 7, so locate it as the column
    left of the anchor and prove it strictly sequential. A wrong guess fails
    loudly rather than silently mis-joining."""
    anchor = cols.get(anchor_header)
    if anchor is None:
        return None
    candidates = [c for c in cols.columns if c.index == anchor.index - 1]
    idx = anchor.index - 1 if not candidates else candidates[0].index
    values = []
    for r in range(header_row + 1, last + 1):
        v = ws.cell(row=r, column=idx).value
        if v is None:
            continue
        try:
            values.append(int(float(v)))
        except (TypeError, ValueError):
            findings.append(Finding("blocking", "counter_not_numeric",
                                    "%s counter column has non-numeric %r at row %d" % (where, v, r)))
            return None
    if values != list(range(1, len(values) + 1)):
        findings.append(Finding("blocking", "counter_not_sequential",
                                "%s counter is not strictly sequential 1..N" % where))
        return None

    class _C:
        index = idx
        header = ""
    return _C()


# ---------------------------------------------------------------- matrix

def parse_matrix(ws, header_row, findings):
    cols = read_columns(ws, header_row, header_row - 1, findings)
    company_col = cols.require("company")
    if company_col is None:
        return {}
    last = last_data_row(ws, company_col.index, header_row + 1)
    counter_col = _counter_column(ws, cols, "company", header_row, last, findings, "matrix")

    excluded = [c for c in cols.columns if c.group in EXCLUDED_GROUP_SLUGS]
    for c in excluded:
        findings.append(Finding(
            "info", "column_excluded_by_scope",
            "column %s (%r) deliberately not ingested: Deloitte client information, "
            "out of POC scope" % (c.letter, c.display)))

    region_cols = {label: cols.get(slug) for slug, label in REGION_HEADERS.items()}
    stage_cols = {"exploration": cols.get("exploration"),
                  "development": cols.get("development"),
                  "production": cols.get("production"),
                  "royalty_streaming": cols.get("royalty streaming")}

    rows = {}
    for r in range(header_row + 1, last + 1):
        company = cell(ws, r, company_col)
        if not company.present:
            continue
        ordinal = None
        if counter_col is not None:
            ov = resolve(ws.cell(row=r, column=counter_col.index).value)
            ordinal = int(float(ov.value)) if ov.present else None

        stages = {name for name, col in stage_cols.items() if parse_marker(cell(ws, r, col))}
        stage_any_col_present = any(col is not None for col in stage_cols.values())
        regions, region_present = {}, {}
        for label, col in region_cols.items():
            v = cell(ws, r, col)
            region_present[label] = v.present
            regions[label] = split_regions(v.value, findings,
                                           "matrix row %d %s" % (r, label)) if v.present else []

        tier_raw = cell(ws, r, cols.get("tier"))
        tier = None
        if tier_raw.present:
            try:
                tier = int(float(tier_raw.value))
            except ValueError:
                findings.append(Finding("blocking", "tier_not_coercible",
                                        "row %d tier %r is not an integer" % (r, tier_raw.raw)))
        if tier is not None and tier not in VALID_TIERS:
            findings.append(Finding("blocking", "tier_out_of_range",
                                    "row %d tier %s outside 1-6" % (r, tier)))

        big4 = cell(ws, r, cols.get("big 4 firms"))
        others = cell(ws, r, cols.get("others"))
        rows[r] = {
            "row": r, "ordinal": ordinal, "company": company.value,
            "exchange": (cell(ws, r, cols.get("exchange")).value or "").strip().upper(),
            "market_cap": parse_money(cell(ws, r, cols.get("market cap (cad)"))),
            "tier_workbook": tier,
            "stages": sorted(stages),
            "stage_evidence": "complete" if stages else ("none" if stage_any_col_present else "none"),
            "regions": regions, "region_present": region_present,
            "footprint_workbook": cell(ws, r, cols.get("canada vs abroad")).value,
            "dtt_market": cell(ws, r, cols.get("dtt market")),
            "auditor_big4": big4, "auditor_other": others,
            "website": cell(ws, r, cols.get("companys website")),
        }
    return rows


# --------------------------------------------------------------- auditor

def parse_auditor(ws, header_row, findings):
    cols = read_columns(ws, header_row, header_row - 1, findings)
    company_col = cols.require("company")
    if company_col is None:
        return {}
    last = last_data_row(ws, company_col.index, header_row + 1)
    rows = {}
    for r in range(header_row + 1, last + 1):
        company = cell(ws, r, company_col)
        if not company.present:
            continue
        eid = cell(ws, r, cols.get("entity id (s&p)"))
        rows[r] = {
            "row": r, "company": company.value,
            "entity_id": eid.value if eid.present else None,
            "auditor_big4": cell(ws, r, cols.get("big 4 firms")),
            "auditor_other": cell(ws, r, cols.get("others")),
        }
    return rows


def resolve_auditor(big4, other, findings, where):
    """Firm class is a property of the firm, never of the column it landed in."""
    for value in (big4, other):
        if not value.present:
            continue
        hit = canonical_firm(value.value)
        if hit is None:
            findings.append(Finding("warning", "auditor_unrecognised",
                                    "%s: auditor %r not in the firm vocabulary" % (where, value.value)))
            continue
        name, klass = hit
        if name == UNNAMED_OTHER:
            continue
        return name, klass, (value.raw, name)
    # 'Other' with nothing named is a real state, distinct from unknown.
    for value in (big4, other):
        if value.present and canonical_firm(value.value) == (UNNAMED_OTHER, None):
            return UNNAMED_OTHER, None, None
    return None, None, None


# ------------------------------------------------------------ orchestration

def _non_empty_count(ws, col, first, last):
    return sum(1 for r in range(first, last + 1)
               if ws.cell(row=r, column=col.index).value not in (None, ""))


def ingest(path):
    """Parse one whitespace workbook. Returns (companies, report)."""
    findings: List[Finding] = []
    zip_report = inspect_package(path)
    findings.extend(zip_report.findings)

    wb = openpyxl.load_workbook(path, data_only=True)
    roles = bind_sheets(wb, findings)
    for role in ("matrix", "consolidated", "auditor", "extract"):
        if role not in roles:
            findings.append(Finding("blocking", "sheet_missing",
                                    "no sheet matched the %s signature" % role))
    if any(f.kind == "blocking" for f in findings):
        return {}, _report(findings, {}, {}, None)

    matrix = parse_matrix(*roles["matrix"][0], findings=findings)
    consolidated = parse_consolidated(*roles["consolidated"][0], findings=findings)
    auditor = parse_auditor(*roles["auditor"][0], findings=findings)

    extracts, filters = {}, []
    for ws, hdr in roles["extract"]:
        rows, meta = parse_extract(ws, hdr, findings)
        extracts.update(rows)
        if meta:
            filters.append(meta)

    # --- period date: header-derived only; never the tab name -------------
    header_dates = {r["as_of"] for r in extracts.values() if r.get("as_of")}
    period = None
    if len(header_dates) == 1:
        period = next(iter(header_dates))
    elif len(header_dates) > 1:
        findings.append(Finding("blocking", "period_ambiguous",
                                "market-cap headers disagree: %s" % sorted(header_dates)))
    else:
        findings.append(Finding("blocking", "period_unresolvable",
                                "no as-of date captured from any market-cap header"))

    # --- identity: matrix ordinal -> consolidated ordinal -> ticker -------
    by_ordinal = {r["ordinal"]: r for r in consolidated.values() if r["ordinal"] is not None}
    companies = {}
    for mrow in matrix.values():
        cons = by_ordinal.get(mrow["ordinal"])
        if cons is None:
            findings.append(Finding("blocking", "identity_unresolved",
                                    "matrix row %d (ordinal %s, %r) has no consolidated row"
                                    % (mrow["row"], mrow["ordinal"], mrow["company"])))
            continue
        if _norm_name(cons["name"] or "") != _norm_name(mrow["company"] or ""):
            findings.append(Finding("warning", "name_mismatch",
                                    "ordinal %s: matrix %r vs consolidated %r"
                                    % (mrow["ordinal"], mrow["company"], cons["name"])))
        key = (cons["ticker"], cons["exchange"])
        ext = extracts.get(key)
        if ext is None:
            findings.append(Finding("blocking", "extract_unresolved",
                                    "%s/%s not found in either extract tab" % key))
            continue

        # --- three-way region merge: a re-upload must not delete research ---
        regions, provenance = {}, {}
        for label in REGION_HEADERS.values():
            ext_vals = ext["regions"].get(label) or []
            prior_vals = cons["regions"].get(label) or []
            if ext_vals:
                regions[label] = ext_vals
                provenance[label] = "extract"
            elif prior_vals:
                regions[label] = prior_vals
                provenance[label] = "analyst_retained"
                findings.append(Finding(
                    "warning", "region_carried_forward",
                    "%s (%s): %s %r absent from the extract, carried forward"
                    % (cons["name"], cons["ticker"], label, ", ".join(prior_vals))))
            else:
                regions[label] = []
                provenance[label] = "absent"

        firm, klass, diff = resolve_auditor(mrow["auditor_big4"], mrow["auditor_other"],
                                            findings, "matrix row %d" % mrow["row"])
        if diff and clean_text(diff[0]) != diff[1]:
            findings.append(Finding("warning", "auditor_normalised",
                                    "%s: %r -> %r" % (cons["name"], diff[0], diff[1])))

        # Only a URL is carried as the website. 45 of the 143 populated values
        # are page titles; a title is routed to enrichment rather than stored
        # as a URL, because downstream the value is used as one.
        website = mrow["website"]
        website_url = None
        if website.present:
            if website.value.lower().startswith(("http://", "https://", "www.")):
                website_url = website.value
            else:
                findings.append(Finding("warning", "website_is_title",
                                        "%s: website value is a page title, not a URL"
                                        % cons["name"]))

        has_props = any(regions[l] for l in REGION_HEADERS.values())
        if not has_props:
            findings.append(Finding("warning", "no_properties",
                                    "%s has no value in any region column" % cons["name"]))

        companies[key] = {
            "ticker": cons["ticker"], "exchange": cons["exchange"],
            "name": cons["name"], "ordinal": mrow["ordinal"],
            "market_cap": ext["market_cap"] or cons["market_cap"] or mrow["market_cap"],
            "stages": mrow["stages"],
            "stage_evidence": "complete" if mrow["stages"] else "none",
            "regions": regions, "region_provenance": provenance,
            "property_evidence": "complete" if has_props else "none",
            "commodities": ext["commodities"],
            "venture_graduate": ext["venture_graduate"],
            "auditor": firm, "auditor_class": klass,
            "website": website_url,
            # A country typed into the market column is a DATA-ENTRY ERROR, not
            # a market. It is surfaced rather than coerced into the enum.
            "dtt_market": _market_value(mrow["dtt_market"], cons["name"], findings),
            "tier_workbook": mrow["tier_workbook"],
            "footprint_workbook": mrow["footprint_workbook"],
        }

    # --- auditor tab join -------------------------------------------------
    # The entity identifier exists only on this tab, so there is nothing to join
    # it AGAINST on the first ingest: the join is by normalised name, and the id
    # is attached so later periods have a stable non-ticker key. That is the
    # whole reason it is carved out of the empty-artifact scope cut (decision 5).
    by_name = {}
    for c in companies.values():
        by_name.setdefault(_norm_name(c["name"] or ""), []).append(c)
    eid_hits = attached = unjoined = 0
    for a in auditor.values():
        if a["entity_id"]:
            eid_hits += 1
        target = by_name.get(_norm_name(a["company"] or ""))
        if not target or len(target) != 1:
            unjoined += 1
            continue
        if a["entity_id"]:
            target[0]["entity_id"] = a["entity_id"]
            attached += 1
    if unjoined:
        findings.append(Finding("warning", "auditor_join_unresolved",
                                "%d auditor rows resolved to zero or several companies "
                                "-> manual merge queue" % unjoined))
    findings.append(Finding("info", "entity_ids_attached",
                            "%d of %d auditor rows carry a real entity identifier; "
                            "%d attached to a company as a stable non-ticker key"
                            % (eid_hits, len(auditor), attached)))

    proofs = _proofs(companies, matrix, consolidated, auditor, extracts, filters, period, findings)

    for meta in filters:
        if meta["criterion"]:
            c = meta["criterion"]
            findings.append(Finding(
                "warning", "source_filter",
                "%s was saved with a filter %s %s on column %s; %d of %d rows are hidden "
                "by it and were read anyway"
                % (meta["sheet"], c["operator"], c["value"], c["column"],
                   meta["hidden"], meta["total"])))

    return companies, _report(findings, proofs, {"entity_ids": eid_hits}, period)


def _proofs(companies, matrix, consolidated, auditor, extracts, filters, period, findings):
    population = len(companies)
    tiers = Counter(c["tier_workbook"] for c in companies.values())
    exchanges = Counter(c["exchange"] for c in companies.values())
    firms = Counter(c["auditor"] for c in companies.values())
    named = sum(v for k, v in firms.items() if k not in (None, UNNAMED_OTHER))
    unnamed_other = firms.get(UNNAMED_OTHER, 0)
    unknown = firms.get(None, 0)

    above = sum(1 for r in extracts.values()
                if r["market_cap"] is not None and r["market_cap"] >= 200_000_000)

    proofs = OrderedDict()
    proofs["extract rows >= $200M vs consolidated"] = (above, len(consolidated))
    proofs["consolidated vs matrix"] = (len(consolidated), len(matrix))
    proofs["matrix vs auditor tab"] = (len(matrix), len(auditor))
    proofs["tier counts sum to population"] = (sum(tiers.values()), population)
    proofs["exchange counts sum to population"] = (sum(exchanges.values()), population)
    proofs["auditor firms + other + unknown"] = (named + unnamed_other + unknown, population)

    bad = set(exchanges) - KNOWN_EXCHANGES
    if bad:
        findings.append(Finding("blocking", "exchange_vocabulary",
                                "unknown exchange values: %s" % sorted(bad)))
    for label, (actual, expected) in proofs.items():
        if actual != expected:
            findings.append(Finding("blocking", "proof_total",
                                    "%s: %s != %s" % (label, actual, expected)))
    return {"totals": proofs, "tiers": dict(tiers), "exchanges": dict(exchanges),
            "firms": {(k or "unknown"): v for k, v in firms.items()},
            "population": population, "period": period}


def _report(findings, proofs, extra, period):
    return {
        "period": period,
        "blocking": [f for f in findings if f.kind == "blocking"],
        "warnings": [f for f in findings if f.kind == "warning"],
        "info": [f for f in findings if f.kind == "info"],
        "proofs": proofs,
        "extra": extra,
    }

"""Bind sheets by content signature, map columns by compound key, read every row.

Never detect by sheet name, sheet count or an exact-name allowlist: the real
workbook has 13 sheets, two of them undocumented empty dividers, so a count
assertion rejects the genuine file. See docs/design/04.
"""
from __future__ import annotations

import re
from typing import Dict, List, NamedTuple, Optional

from openpyxl.utils import get_column_letter

from .aliases import (ABROAD_COLUMNS, COMMODITY_FLAGS, FOREIGN_ALIASES,
                      FOREIGN_ALIASES_PRESUMED, HEADER_ALIASES, REGION_COLUMNS,
                      canonical_firm)
from .safety import Finding, person_sheet_signature
from .sentinels import absent, resolve
from .textnorm import clean_text, normalise_header

# Columns whose lookup formula falls back to numeric zero.
ZERO_SENTINEL_HEADERS = {"companys website", "website", "others"}

# --- the POC scope constraint -------------------------------------------
# Positively excluded, and named in the report as deliberately skipped rather
# than silently absent, so the exclusion is visible to a later due-diligence
# review. See docs/decisions/QUESTIONS-PACK.md.
EXCLUDED_HEADERS = {
    ("deloitte tax client", "yes no"): "Deloitte client information -- out of POC scope",
    ("", "yes no"): "Deloitte client information -- out of POC scope",
}
EXCLUDED_GROUP_SLUGS = {"deloitte tax client"}

_SPLIT = re.compile(r"\s*(?:,|;|/|&| and )\s*", re.IGNORECASE)


class Column(NamedTuple):
    index: int
    letter: str
    group: str
    header: str
    display: str
    as_of: Optional[str]


class ColumnMap:
    """Resolve by header when unambiguous, by (group, header) when not."""

    def __init__(self, columns: List[Column], findings: List[Finding]):
        self.columns = columns
        self.findings = findings
        self._by_key: Dict[tuple, Column] = {}
        self._by_header: Dict[str, List[Column]] = {}
        self.used = set()          # column indexes actually consumed
        for col in columns:
            key = (col.group, col.header)
            if key in self._by_key:
                other = self._by_key[key]
                findings.append(Finding(
                    "blocking", "duplicate_column_key",
                    "columns %s and %s both resolve to %r" % (other.letter, col.letter, key)))
                continue
            self._by_key[key] = col
            self._by_header.setdefault(col.header, []).append(col)

    def get(self, header: str, group: Optional[str] = None) -> Optional[Column]:
        if group is not None:
            col = self._by_key.get((group, header))
            if col is not None:
                self.used.add(col.index)
            return col
        found = self._by_header.get(header, [])
        if len(found) == 1:
            self.used.add(found[0].index)
            return found[0]
        if len(found) > 1:
            self.findings.append(Finding(
                "blocking", "ambiguous_column",
                "header %r appears in %d columns (%s); a group label is required"
                % (header, len(found), ", ".join(c.letter for c in found))))
        return None

    def require(self, header: str, group: Optional[str] = None) -> Optional[Column]:
        col = self.get(header, group)
        if col is None:
            self.findings.append(Finding(
                "blocking", "required_column_missing",
                "required column %r not resolved after alias lookup" % header))
        return col

    def headers(self):
        return sorted({c.header for c in self.columns})

    def unused(self):
        return [c for c in self.columns if c.index not in self.used]


def read_columns(ws, header_row: int, group_row: Optional[int],
                 findings: List[Finding]) -> ColumnMap:
    """Build the compound-key column map. Group labels forward-fill."""
    columns: List[Column] = []
    group = ""
    for idx in range(1, ws.max_column + 1):
        if group_row is not None:
            raw_group = ws.cell(row=group_row, column=idx).value
            g = normalise_header(raw_group, HEADER_ALIASES)
            if g.present:
                group = g.slug
        h = normalise_header(ws.cell(row=header_row, column=idx).value, HEADER_ALIASES)
        if not h.present:
            continue
        columns.append(Column(idx, get_column_letter(idx), group, h.slug, h.display, h.as_of))
    return ColumnMap(columns, findings)


def last_data_row(ws, col_index: int, first: int) -> int:
    row = first - 1
    for r in range(first, ws.max_row + 1):
        if ws.cell(row=r, column=col_index).value not in (None, ""):
            row = r
    return row


# --- sheet binding -------------------------------------------------------

def _row_slugs(ws, row: int, limit: int = 80):
    out = []
    for c in range(1, min(ws.max_column, limit) + 1):
        h = normalise_header(ws.cell(row=row, column=c).value, HEADER_ALIASES)
        if h.present:
            out.append(h.slug)
    return out


def bind_sheets(wb, findings: List[Finding]):
    """Match each sheet against a content signature. Returns role -> (ws, header_row)."""
    roles = {}
    unmatched_with_data = []
    for ws in wb.worksheets:
        matched = None
        for row in range(1, min(ws.max_row, 20) + 1):
            slugs = set(_row_slugs(ws, row))
            if not slugs:
                continue
            # NB: the design describes this signature as Tier/#/Company/Exchange,
            # but "#" does not survive slug step 7 (non-alphanumerics are
            # stripped), so the stage block stands in as the discriminator.
            if ({"tier", "company", "exchange"} <= slugs
                    and {"exploration", "development", "production"} <= slugs):
                matched = ("matrix", row)
            elif {"ticker", "name", "exchange"} <= slugs and "ho location" in slugs:
                matched = ("consolidated", row)
            elif {"company", "entity id (s&p)"} <= slugs:
                matched = ("auditor", row)
            elif {"co id", "root ticker", "name", "exchange"} <= slugs:
                matched = ("extract", row)
            if matched:
                if person_sheet_signature(slugs):
                    findings.append(Finding(
                        "blocking", "person_data_sheet",
                        "sheet %r matches a roster-of-people signature" % ws.title))
                break
        if matched is None:
            has_data = ws.max_row > 1 and any(
                ws.cell(row=r, column=c).value is not None
                for r in range(1, min(ws.max_row, 12) + 1)
                for c in range(1, min(ws.max_column, 12) + 1))
            if has_data:
                unmatched_with_data.append(ws.title)
            continue
        role, header_row = matched
        roles.setdefault(role, []).append((ws, header_row))
        findings.append(Finding("info", "sheet_bound",
                                "%s <- %r (header row %d)" % (role, ws.title, header_row)))
    for title in unmatched_with_data:
        findings.append(Finding("info", "sheet_not_ingested",
                                "sheet %r holds data but matches no signature" % title))
    return roles


# --- value helpers -------------------------------------------------------

def cell(ws, row: int, col: Optional[Column]):
    if col is None:
        return absent()
    zero = col.header in ZERO_SENTINEL_HEADERS
    return resolve(ws.cell(row=row, column=col.index).value, zero_is_sentinel=zero)


def split_regions(value: str, findings: List[Finding], where: str):
    """Split a region cell and fold spellings through the alias layer."""
    out = []
    for token in _SPLIT.split(value):
        token = clean_text(token)
        if not token:
            continue
        key = token.casefold()
        if key in FOREIGN_ALIASES:
            token = FOREIGN_ALIASES[key]
        elif key in FOREIGN_ALIASES_PRESUMED:
            canonical = FOREIGN_ALIASES_PRESUMED[key]
            findings.append(Finding(
                "warning", "presumed_spelling",
                "%s: %r read as %r -- presumed, needs confirming" % (where, token, canonical)))
            token = canonical
        out.append(token)
    return out


def parse_marker(v) -> bool:
    """Stage and commodity columns use a presence marker, not a boolean."""
    return v.present and v.value.strip().casefold() in {"x", "y", "yes", "true", "1"}


def parse_money(v) -> Optional[float]:
    if not v.present:
        return None
    text = re.sub(r"[^0-9.\-]", "", v.value)
    try:
        return float(text) if text not in ("", "-", ".") else None
    except ValueError:
        return None

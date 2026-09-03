"""Storage-boundary controls. These run before any sheet is read.

Both source files carry personal data and third-party licences, so this is not
a matter of skipping one sheet. See docs/design/11-security-privacy-compliance.md.
"""
from __future__ import annotations

import re
import zipfile
from typing import List, NamedTuple

# Upload guards. The real whitespace workbook expands 8.7x from ~1 MB, mostly
# one 6 MB drawing part, so the ratio ceiling has to clear that legitimately.
MAX_UPLOAD_BYTES = 40 * 1024 * 1024
MAX_INFLATED_BYTES = 400 * 1024 * 1024
MAX_ENTRIES = 2000
MAX_SINGLE_ENTRY_BYTES = 120 * 1024 * 1024
MAX_EXPANSION_RATIO = 60.0

# Parts stripped before any sheet is read.
STRIP_PREFIXES = (
    "xl/comments", "xl/threadedComments", "xl/drawings", "xl/media",
    "docProps/", "xl/legacyDrawing",
)

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# A person-data sheet is detected by header signature, not by name.
_PERSON_HEADERS = {
    "partner", "partners", "relationship partner", "client contact",
    "contact name", "lead partner", "engagement partner", "response",
    "client response", "contacted by", "owner",
}


class Finding(NamedTuple):
    kind: str          # 'blocking' | 'warning' | 'info'
    code: str
    detail: str


class ZipReport(NamedTuple):
    entries: int
    compressed: int
    inflated: int
    ratio: float
    stripped: List[str]
    findings: List[Finding]


def inspect_package(path) -> ZipReport:
    """Read the package parts directly. Rejects macro-bearing and external-link
    workbooks outright, and reports the parts that will be stripped."""
    findings: List[Finding] = []
    stripped: List[str] = []
    entries = compressed = inflated = 0

    with zipfile.ZipFile(path) as zf:
        infos = zf.infolist()
        entries = len(infos)
        if entries > MAX_ENTRIES:
            findings.append(Finding("blocking", "zip_entry_count",
                                    "%d entries exceeds %d" % (entries, MAX_ENTRIES)))
        for info in infos:
            compressed += info.compress_size
            inflated += info.file_size
            if info.file_size > MAX_SINGLE_ENTRY_BYTES:
                findings.append(Finding("blocking", "zip_entry_size",
                                        "%s is %d bytes" % (info.filename, info.file_size)))
            name = info.filename
            if name.startswith("xl/macrosheets") or name.endswith("vbaProject.bin"):
                findings.append(Finding("blocking", "macros",
                                        "workbook carries macros (%s)" % name))
            if name.startswith("xl/externalLinks"):
                findings.append(Finding("blocking", "external_links",
                                        "workbook carries external links (%s)" % name))
            if any(name.startswith(p) for p in STRIP_PREFIXES):
                stripped.append(name)

    ratio = (inflated / compressed) if compressed else 0.0
    if inflated > MAX_INFLATED_BYTES:
        findings.append(Finding("blocking", "zip_inflated",
                                "%d inflated bytes exceeds %d" % (inflated, MAX_INFLATED_BYTES)))
    if ratio > MAX_EXPANSION_RATIO:
        findings.append(Finding("blocking", "zip_ratio",
                                "expansion ratio %.1fx exceeds %.1fx" % (ratio, MAX_EXPANSION_RATIO)))
    if stripped:
        findings.append(Finding("info", "parts_stripped",
                                "%d package parts stripped before parsing: %s" % (
                                    len(stripped), ", ".join(sorted(set(
                                        p.split("/")[0] + "/" + p.split("/")[1]
                                        if "/" in p else p for p in stripped))[:6]))))
    return ZipReport(entries, compressed, inflated, ratio, stripped, findings)


def person_sheet_signature(header_slugs) -> bool:
    """True when a sheet's headers look like a roster of people."""
    hits = sum(1 for s in header_slugs if s in _PERSON_HEADERS)
    return hits >= 2


def scan_for_person_data(sheet_title, cells):
    """Tripwire over ingested free text.

    `cells` is an iterable of (coordinate, value). A hit BLOCKS the commit and
    is logged with coordinates only -- never the value.
    """
    findings: List[Finding] = []
    for coord, value in cells:
        if not isinstance(value, str):
            continue
        if _EMAIL.search(value):
            findings.append(Finding(
                "blocking", "person_data",
                "email-shaped value at %s!%s -- commit blocked, value not logged"
                % (sheet_title, coord)))
    return findings

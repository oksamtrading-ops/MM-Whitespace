"""Header and value normalisation.

The header algorithm is ordered and every step is separately testable; see
docs/design/04-ingestion-and-parsing.md. Order matters -- steps 3-5 must run
before any comparison, including sentinel matching.
"""
from __future__ import annotations

import re
import unicodedata
from typing import NamedTuple, Optional

_WS_RUN = re.compile(r"\s+")
_LINEBREAK = re.compile(r"[\r\n\t]+")

# 31-May-2026, 31 May 2026, 2026-05-31
_FULL_DATE = re.compile(
    r"\b(\d{1,2})[-/ ](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/ ](\d{4})\b",
    re.IGNORECASE,
)
_ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_BARE_YEAR = re.compile(r"\b(19|20)\d{2}\b")

_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

# Step 7 keeps alphanumerics, spaces, parentheses, currency and ampersand.
_SLUG_STRIP = re.compile(r"[^0-9a-z ()$&]")
# Apostrophes are elided rather than spaced: they sit inside a word, unlike a
# hyphen or slash, so "Company's Website" must fold onto "companys website"
# and not split into "company s website".
_APOSTROPHE = re.compile(r"[’ʼ']")


class Header(NamedTuple):
    """One parsed header cell."""
    raw: Optional[str]        # exactly as read
    display: str              # after steps 2-5, human readable
    slug: str                 # after step 7, comparison key
    as_of: Optional[str]      # ISO date captured in step 6, if a full date
    as_of_year: Optional[int]  # bare year captured in step 6, if only a year

    @property
    def present(self) -> bool:
        return self.slug != ""


def clean_text(value) -> str:
    """Steps 2-5. The minimum every value must pass through before comparison."""
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    value = unicodedata.normalize("NFKC", value)   # 2
    value = _LINEBREAK.sub(" ", value)             # 3
    value = _WS_RUN.sub(" ", value)                # 4
    return value.strip()                           # 5


def _extract_date(text: str):
    """Step 6. Returns (text_without_date, iso_date, bare_year)."""
    m = _FULL_DATE.search(text)
    if m:
        day, mon, year = int(m.group(1)), m.group(2).lower()[:3], int(m.group(3))
        iso = "%04d-%02d-%02d" % (year, _MONTHS[mon], day)
        return _WS_RUN.sub(" ", text[:m.start()] + " " + text[m.end():]).strip(), iso, None
    m = _ISO_DATE.search(text)
    if m:
        iso = "%s-%s-%s" % (m.group(1), m.group(2), m.group(3))
        return _WS_RUN.sub(" ", text[:m.start()] + " " + text[m.end():]).strip(), iso, None
    m = _BARE_YEAR.search(text)
    if m:
        # A bare year is recorded but NOT stripped: "2025 TSX30" and
        # "2026 Venture 50" are index names, and removing the year would fold
        # two distinct columns onto one key.
        return text, None, int(m.group(0))
    return text, None, None


def normalise_header(value, aliases=None) -> Header:
    """The full ordered algorithm. `aliases` maps slug -> canonical slug (step 8)."""
    if value is None or (not isinstance(value, str) and not isinstance(value, (int, float))):
        if value is None:
            return Header(None, "", "", None, None)                       # 1
    raw = value if isinstance(value, str) else None
    display = clean_text(value)
    if display == "":
        return Header(raw, "", "", None, None)

    stripped, iso, year = _extract_date(display)                          # 6

    slug = _APOSTROPHE.sub("", stripped.casefold())
    slug = slug.replace(".", " ").replace("-", " ").replace("_", " ").replace("/", " ")
    slug = _SLUG_STRIP.sub(" ", slug)
    slug = _WS_RUN.sub(" ", slug).strip()                                 # 7

    if aliases:
        slug = aliases.get(slug, slug)                                    # 8
    return Header(raw, display, slug, iso, year)

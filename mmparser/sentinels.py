"""Missing values take six forms and one of them is a number.

Ingest must distinguish three states a naive parser conflates:
  ABSENT  -- the column is not in the file. Asserts nothing; leave prior value.
  BLANK   -- the cell is empty. Asserts absence.
  sentinel-- the cell holds a marker meaning "looked, found nothing".
Only the last two assert absence. See docs/design/04.
"""
from __future__ import annotations

from typing import NamedTuple, Optional

from .textnorm import clean_text

ABSENT = "absent"            # column not present in the file
BLANK = "blank"
NOT_FOUND = "not_found"
NOT_APPLICABLE = "not_applicable"
FORMULA_ZERO = "formula_zero"   # numeric 0 produced by a lookup's own fallback

_TEXT_SENTINELS = {
    "not found": NOT_FOUND,
    "notfound": NOT_FOUND,
    "n/a": NOT_APPLICABLE,
    "na": NOT_APPLICABLE,
    "#n/a": NOT_APPLICABLE,
    "-": NOT_APPLICABLE,
}


class Value(NamedTuple):
    """A cell after sentinel resolution."""
    value: Optional[str]      # None when missing
    reason: Optional[str]     # why it is missing, None when present
    raw: object               # exactly as read, for the before/after diff

    @property
    def present(self) -> bool:
        return self.value is not None

    @property
    def asserts_absence(self) -> bool:
        """True when the source actually claims there is nothing here."""
        return self.reason is not None and self.reason != ABSENT


def resolve(raw, zero_is_sentinel: bool = False) -> Value:
    """Trim BEFORE sentinel matching, always -- or 'Not found ' survives as a
    distinct value.

    `zero_is_sentinel` is set for columns whose lookup formula falls back to
    numeric 0 (the website column and the auditor 'Others' column, measured at
    99 occurrences). Elsewhere 0 is a legitimate figure.
    """
    if raw is None:
        return Value(None, BLANK, raw)
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        if zero_is_sentinel and raw == 0:
            return Value(None, FORMULA_ZERO, raw)
        return Value(str(raw), None, raw)

    text = clean_text(raw)
    if text == "":
        return Value(None, BLANK, raw)
    reason = _TEXT_SENTINELS.get(text.casefold())
    if reason is not None:
        return Value(None, reason, raw)
    return Value(text, None, raw)


def absent() -> Value:
    """The column is not in the file at all."""
    return Value(None, ABSENT, None)

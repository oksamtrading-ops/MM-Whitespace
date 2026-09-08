"""The one writer helper every export path goes through.

Nine cells in the source workbook already begin with `@`, so formula injection
is an active concern with a live example rather than a theoretical one. Worse,
two of the strings this application writes are attacker-influenced: analyst
overrides are free text, and evidence excerpts are model-generated strings taken
verbatim from third-party pages -- so whoever controls an issuer's
investor-relations page controls a string that lands in a partner's spreadsheet.

Every cell in every export path is written through `put`. There is no second
path, and a test asserts the sheet contains no unguarded interpretable string.

See docs/design/10-excel-export.md.
"""
from __future__ import annotations

import re
from typing import Any, Optional

# Excel begins evaluating a cell when it starts with one of these.
INTERPRETABLE_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

# Excel's own ceiling is 32767; stop well short so a runaway model string is
# capped at the writer rather than by trusting the model to respect a limit.
MAX_STRING = 4000

# Control characters Excel rejects or renders as mojibake. Tab and CR are
# handled by the prefix rule above and stripped here as well.
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

TRUNCATION_MARK = "...[truncated]"


def needs_quote_prefix(value: Any) -> bool:
    """True when Excel would try to interpret this cell on open."""
    return isinstance(value, str) and value.startswith(INTERPRETABLE_PREFIXES)


def sanitize(value: Any) -> Any:
    """Strip control characters and cap length. Does not alter the leading
    character -- that is handled by the quote-prefix flag, which is lossless."""
    if not isinstance(value, str):
        return value
    cleaned = _CONTROL.sub("", value)
    cleaned = cleaned.replace("\t", " ").replace("\r", "")
    if len(cleaned) > MAX_STRING:
        cleaned = cleaned[: MAX_STRING - len(TRUNCATION_MARK)] + TRUNCATION_MARK
    return cleaned


def put(ws, row: int, column: int, value: Any, *,
        formula: bool = False, comment: Optional[str] = None,
        number_format: Optional[str] = None):
    """Write one cell safely.

    `formula=True` is for formulas the APPLICATION authored. It is never set
    from data, so a value that merely looks like a formula can never be
    evaluated: it is quote-prefixed instead.
    """
    cell = ws.cell(row=row, column=column)

    if formula:
        if not isinstance(value, str) or not value.startswith("="):
            raise ValueError("formula=True requires a string beginning with '='")
        cell.value = value
        if number_format:
            cell.number_format = number_format
        return cell

    safe = sanitize(value)
    cell.value = safe
    if needs_quote_prefix(safe):
        # Lossless: the stored value keeps its leading character and Excel is
        # told to treat it as text. Prefixing an apostrophe into the value
        # itself would corrupt the legitimate @-prefixed date labels.
        cell.quotePrefix = True
    if number_format:
        cell.number_format = number_format
    if comment:
        from openpyxl.comments import Comment
        cell.comment = Comment(sanitize(comment), "Mining Whitespace Tool")
    return cell


def put_row(ws, row: int, values, *, start_column: int = 1, **kwargs):
    """Write a whole row through the same guard."""
    for offset, value in enumerate(values):
        put(ws, row, start_column + offset, value, **kwargs)


def audit_sheet(ws):
    """Return every cell that holds an interpretable string without the flag.

    Used by the test suite over a fully generated export, so a future column
    added by a different code path cannot silently bypass the guard.
    """
    offenders = []
    for row in ws.iter_rows():
        for cell in row:
            v = cell.value
            if not isinstance(v, str):
                continue
            if v.startswith("="):
                continue  # an application-authored formula
            if v.startswith(INTERPRETABLE_PREFIXES) and not cell.quotePrefix:
                offenders.append((ws.title, cell.coordinate, v[:40]))
    return offenders

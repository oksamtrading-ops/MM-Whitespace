"""Parse an uploaded workbook for the web application.

The production upload runs here, as a function beside the Next.js app, because
Vercel's Node functions have no Python and this parser is the most thoroughly
checked code in the project -- 49 tests and 54 ground-truth checks. Rewriting it
would have meant a second parser to keep in step with the first. So the web
application runs the same ``ingest()`` the command line runs, and turns the
result into the same payload through the same ``to_payload()``.

Nothing is stored. The workbook is written to a private temporary file because
the parser reads a path, and it is deleted in the same call whether the parse
succeeds or not: there is no durable copy of a licensed extract anywhere.

This module knows nothing about HTTP. ``api/parse.py`` adapts it to a request,
so moving to a different hosting model changes that file and not this one.
"""
from __future__ import annotations

import hmac
import os
import tempfile

from .cli import to_payload
from .ingest import ingest

#: Matches MAX_UPLOAD_BYTES in src/lib/ingest/quarantine.ts. The platform's own
#: request limit is lower; this is what stops a mistake before it is read.
MAX_BYTES = 25 * 1024 * 1024

#: The first two bytes of every .xlsx, which is a zip archive.
ZIP_MAGIC = b"PK"


class Refused(Exception):
    """A request this function will not act on. ``status`` is the HTTP code."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def authorised(presented, secret=None):
    """Constant-time comparison against MM_PARSE_SECRET.

    An unset secret fails CLOSED. This function reads licensed workbooks, and
    one that anyone could post to would be a free parser for them.
    """
    secret = os.environ.get("MM_PARSE_SECRET") if secret is None else secret
    if not secret or not presented:
        return False
    return hmac.compare_digest(presented.encode("utf-8"), secret.encode("utf-8"))


def parse_bytes(data):
    """Parse workbook bytes into the payload the commit step reads.

    Blocking findings are part of the payload, not an error: the Analyst is
    entitled to read what the parser found. Only a file that cannot be read at
    all raises.
    """
    if not data:
        raise Refused(400, "That file is empty.")
    if len(data) > MAX_BYTES:
        raise Refused(413, "That file is larger than %d MB." % (MAX_BYTES // 1048576))
    if not data.startswith(ZIP_MAGIC):
        raise Refused(415, "That is not an .xlsx workbook.")

    fd, path = tempfile.mkstemp(suffix=".xlsx")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        try:
            companies, report = ingest(path)
        except Exception as exc:  # the parser's own refusal, or a corrupt file
            raise Refused(422, "That workbook could not be read: %s"
                          % str(exc).splitlines()[0][:300])
        return to_payload(companies, report)
    finally:
        # The licensed extract does not outlive the request that carried it.
        try:
            os.remove(path)
        except FileNotFoundError:
            pass

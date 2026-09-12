"""POST /api/export -- the workbook builder, as a Vercel Python function.

A thin adapter: everything that matters is in mmparser/export_service.py. The
request body is the period as JSON, built by the application from its own
database; the response is the .xlsx.

Every request must carry ``X-MM-Parse-Secret`` -- the same secret the parser
uses, because both are this application talking to itself. Missing and wrong
secrets get the same response, so the endpoint does not confirm a close guess.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

# Vercel runs this from the project root; make the package importable either way.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mmparser.export_service import flat_csv_text, workbook_bytes  # noqa: E402
from mmparser.service import Refused, authorised  # noqa: E402

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
#: The payload for 259 companies is well under a megabyte of JSON.
MAX_REQUEST_BYTES = 16 * 1024 * 1024


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body, content_type="application/json"):
        raw = json.dumps(body, default=str).encode("utf-8") if content_type == "application/json" else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        # Health, for whoever deploys this -- but only to a caller who holds the
        # secret, so the endpoint's existence says nothing to anyone else.
        if not authorised(self.headers.get("X-MM-Parse-Secret")):
            return self._send(401, {"error": "unauthorized"})
        import openpyxl
        return self._send(200, {"ready": True, "python": sys.version.split()[0],
                                "openpyxl": openpyxl.__version__})

    def do_POST(self):
        if not authorised(self.headers.get("X-MM-Parse-Secret")):
            return self._send(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._send(400, {"error": "bad Content-Length"})
        if length > MAX_REQUEST_BYTES:
            return self._send(413, {"error": "That period is too large to export."})
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:
            return self._send(400, {"error": "The export payload is not JSON."})
        try:
            if self.headers.get("X-MM-Export-Format") == "csv":
                return self._send(200, flat_csv_text(data).encode("utf-8"), "text/csv; charset=utf-8")
            return self._send(200, workbook_bytes(data), XLSX)
        except Refused as r:
            return self._send(r.status, {"error": r.message})

    def log_message(self, fmt, *args):
        # The default handler logs request lines to stderr. Nothing here is
        # worth logging, and a period's contents must never be.
        pass

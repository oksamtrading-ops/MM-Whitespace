"""POST /api/parse -- the upload parser, as a Vercel Python function.

A thin adapter: everything that matters is in mmparser/service.py. The request
body is the raw workbook; the response is the parsed payload as JSON.

Every request must carry ``X-MM-Parse-Secret``. Missing and wrong secrets get
the same response, so the endpoint does not confirm that a guess was close.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

# Vercel runs this from the project root; make the package importable either way.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mmparser.service import Refused, authorised, parse_bytes  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        raw = json.dumps(body, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        # Health, for whoever deploys this -- but only to a caller who holds
        # the secret, so the endpoint's existence says nothing to anyone else.
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
        try:
            if length > 25 * 1024 * 1024:
                raise Refused(413, "That file is too large.")
            payload = parse_bytes(self.rfile.read(length))
        except Refused as r:
            return self._send(r.status, {"error": r.message})
        return self._send(200, payload)

    def log_message(self, fmt, *args):
        # The default handler logs request lines to stderr. Nothing here is
        # worth logging, and a workbook's contents must never be.
        pass

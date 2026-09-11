"""The production upload parser, driven over real HTTP on localhost."""
import importlib.util
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import HTTPServer

from mmparser import service
from mmparser.cli import to_payload
from mmparser.ingest import ingest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "synthetic_whitespace.xlsx")
SECRET = "test-parse-secret"


def load_handler():
    spec = importlib.util.spec_from_file_location("api_parse", os.path.join(ROOT, "api", "parse.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.handler


class ParseEndpoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), load_handler())
        cls.url = "http://127.0.0.1:%d/api/parse" % cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self._was = os.environ.get("MM_PARSE_SECRET")
        os.environ["MM_PARSE_SECRET"] = SECRET

    def tearDown(self):
        if self._was is None:
            os.environ.pop("MM_PARSE_SECRET", None)
        else:
            os.environ["MM_PARSE_SECRET"] = self._was

    def post(self, body, secret=SECRET):
        headers = {"Content-Type": "application/octet-stream"}
        if secret is not None:
            headers["X-MM-Parse-Secret"] = secret
        req = urllib.request.Request(self.url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read())

    def test_parses_exactly_what_the_command_line_parses(self):
        with open(FIXTURE, "rb") as fh:
            status, body = self.post(fh.read())
        self.assertEqual(status, 200)
        expected = json.loads(json.dumps(to_payload(*ingest(FIXTURE)), default=str))
        self.assertEqual(body, expected,
                         "the web upload and the command line must build identical payloads")

    def test_missing_and_wrong_secrets_get_the_same_answer(self):
        with open(FIXTURE, "rb") as fh:
            data = fh.read()
        self.assertEqual(self.post(data, secret=None), (401, {"error": "unauthorized"}))
        self.assertEqual(self.post(data, secret="close-but-no"), (401, {"error": "unauthorized"}))

    def test_an_unset_server_secret_fails_closed(self):
        os.environ.pop("MM_PARSE_SECRET")
        with open(FIXTURE, "rb") as fh:
            status, _ = self.post(fh.read(), secret="")
        self.assertEqual(status, 401)
        self.assertFalse(service.authorised("anything", secret=""))

    def test_junk_is_refused_before_the_parser_sees_it(self):
        self.assertEqual(self.post(b"")[0], 400)
        self.assertEqual(self.post(b"not a zip at all")[0], 415)
        self.assertEqual(self.post(b"PK\x03\x04 but not a workbook")[0], 422)

    def test_the_workbook_does_not_outlive_the_request(self):
        made = []
        real = tempfile.mkstemp

        def spy(*a, **k):
            fd, path = real(*a, **k)
            made.append(path)
            return fd, path

        tempfile.mkstemp = spy
        try:
            with open(FIXTURE, "rb") as fh:
                self.assertEqual(self.post(fh.read())[0], 200)
            self.post(b"PK\x03\x04 but not a workbook")
        finally:
            tempfile.mkstemp = real
        self.assertEqual(len(made), 2)
        for path in made:
            self.assertFalse(os.path.exists(path), "%s was left on disk" % path)


if __name__ == "__main__":
    unittest.main()

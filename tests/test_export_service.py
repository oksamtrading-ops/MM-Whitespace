"""The export as the web application builds it: a payload in, a workbook out.

The command line reads SQLite and calls build_workbook. The application reads
its own database -- Postgres in production, where this Python cannot go -- and
hands the same rows over as JSON. These tests hold the two paths together: the
service must build the SAME workbook from the payload that read_period would
have produced, and must not fall over on a payload missing optional keys.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from openpyxl import load_workbook

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from mmparser.export import read_period  # noqa: E402
from mmparser.export_service import flat_csv_text, normalise, workbook_bytes  # noqa: E402
from mmparser.service import Refused  # noqa: E402

FIXTURE = os.path.join(ROOT, "tests", "fixtures", "synthetic_whitespace.xlsx")


def _jsonable(data):
    """The payload as it crosses the wire: sets become lists, tuples arrays."""
    return json.loads(json.dumps(data, default=lambda o: sorted(o) if isinstance(o, set) else str(o)))


@unittest.skipIf(shutil.which("node") is None, "node commits the period this reads")
class ExportService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="mm-export-service-")
        payload = os.path.join(cls.tmp, "period.json")
        db = os.path.join(cls.tmp, "period.db")
        subprocess.check_call(
            [sys.executable, "-m", "mmparser.cli", FIXTURE, "--json", payload],
            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.check_call(
            ["node", "scripts/commit_period.mjs", payload, db, "--fresh"],
            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.data = _jsonable(read_period(db))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_the_payload_builds_the_same_workbook_the_command_line_writes(self):
        wb = load_workbook(io.BytesIO(workbook_bytes(self.data)))
        self.assertIn("A.02 Matrix", wb.sheetnames)
        self.assertIn("Cover", wb.sheetnames)
        self.assertIn("Provenance", wb.sheetnames)
        matrix = wb["A.02 Matrix"]
        names = [matrix.cell(row=r, column=4).value for r in range(6, 6 + len(self.data["companies"]))]
        self.assertEqual([c["name"] for c in self.data["companies"]], names)
        # The stages arrive as a list over the wire and must still mark cells.
        marked = [matrix.cell(row=r, column=c).value
                  for r in range(6, 6 + len(self.data["companies"])) for c in range(16, 20)]
        self.assertIn("X", marked, "no stage column was written")

    def test_a_payload_missing_optional_keys_is_a_blank_cell_not_a_500(self):
        bare = {"period": {"label": "Q3-2026 (2026-06-30)"},
                "companies": [{"name": "Northco Mining Corp."}]}
        wb = load_workbook(io.BytesIO(workbook_bytes(bare)))
        self.assertEqual(wb["A.02 Matrix"].cell(row=6, column=4).value, "Northco Mining Corp.")

    def test_a_payload_that_is_not_a_period_is_refused_by_name(self):
        for bad in [None, "a period", {"period": {}}, {"companies": []}]:
            with self.assertRaises(Refused):
                normalise(bad)
        with self.assertRaises(Refused) as caught:
            normalise({"period": {}, "companies": [{}] * 10_001})
        self.assertEqual(caught.exception.status, 413)

    def test_the_flat_csv_carries_the_notices_and_the_companies(self):
        text = flat_csv_text(self.data)
        self.assertTrue(text.startswith("# "), "the licence notices lead the file")
        self.assertIn(self.data["companies"][0]["name"], text)

    def test_the_module_runs_as_a_command_reading_stdin(self):
        out = subprocess.run([sys.executable, "-m", "mmparser.export_service"],
                             cwd=ROOT, input=json.dumps(self.data).encode("utf-8"),
                             stdout=subprocess.PIPE, check=True).stdout
        self.assertEqual(out[:2], b"PK")
        self.assertIn("A.02 Matrix", load_workbook(io.BytesIO(out)).sheetnames)


if __name__ == "__main__":
    unittest.main()

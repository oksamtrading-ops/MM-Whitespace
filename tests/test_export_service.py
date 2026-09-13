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


def _payload_with_fees():
    """Two companies, two currencies -- what Run 1 actually produced."""
    return {
        "period": {"label": "Q3-2026 (2026-05-31)", "market_cap_as_of": "2026-05-31",
                   "threshold_amount": 200000000, "threshold_operator": "gte",
                   "threshold_currency": "CAD", "proximity_band_pct": 2, "status": "published",
                   "revision": 6, "rule_set_version": "1.0.0"},
        "companies": [
            {"name": "Agnico Eagle Mines Limited", "tier": 1, "status": "classified",
             "footprint": "canada_and_abroad", "rule_set_version": "1.0.0",
             "stages": ["production", "exploration", "development"],
             "values": {"root_ticker": "AEM", "exchange": "TSX", "market_cap_cad": 78000000000,
                        "auditor": "Ernst & Young", "head_office_location": "Toronto",
                        "audit_fee": {"amount": 8052000, "currency": "CAD", "fiscal_year": 2025},
                        "tax_fee": {"amount": 382000, "currency": "CAD", "fiscal_year": 2025}}},
            {"name": "Elemental Royalty Corporation", "tier": 4, "status": "classified",
             "footprint": "abroad", "rule_set_version": "1.0.0", "stages": ["royalty_streaming"],
             "values": {"root_ticker": "ELE", "exchange": "TSXV", "market_cap_cad": 400000000,
                        "auditor": "Davidson & Company", "head_office_location": "Littleton",
                        "audit_fee": {"amount": 517116, "currency": "USD", "fiscal_year": 2025},
                        "tax_fee": {"amount": 0, "currency": "USD", "fiscal_year": 2025}}},
        ],
        "provenance": {"source_file_sha256": "abc", "rule_set_version": "1.0.0",
                       "prior_period": None},
    }


class Presentation(unittest.TestCase):
    """What a partner sees. A workbook nobody can read is not a deliverable."""

    @classmethod
    def setUpClass(cls):
        cls.wb = load_workbook(io.BytesIO(workbook_bytes(_payload_with_fees())))

    def test_every_amount_says_which_currency_it_is_in(self):
        matrix = self.wb["A.02 Matrix"]
        # Market cap is Canadian dollars, and says so rather than being a bare number.
        self.assertIn("C$", matrix.cell(row=6, column=6).number_format)
        # Fees carry the currency of the filing they came from.
        self.assertEqual(matrix.cell(row=6, column=40).value, "CAD")
        self.assertEqual(matrix.cell(row=6, column=41).value, 8052000)
        self.assertIn("C$", matrix.cell(row=6, column=41).number_format)
        self.assertEqual(matrix.cell(row=7, column=40).value, "USD")
        self.assertIn("US$", matrix.cell(row=7, column=41).number_format)
        self.assertEqual(matrix.cell(row=6, column=43).value, 2025, "the fiscal year travels too")

    def test_a_foreign_fee_is_not_converted_at_a_rate_nobody_chose(self):
        matrix = self.wb["A.02 Matrix"]
        # Canadian dollars need no conversion, so the CAD column is filled.
        self.assertEqual(matrix.cell(row=6, column=42).value, 8052000)
        # US dollars do, and there is no FX table: empty, with the reason on it.
        usd_cad = matrix.cell(row=7, column=42)
        self.assertIsNone(usd_cad.value)
        self.assertIsNotNone(usd_cad.comment, "an empty cell must say why it is empty")
        self.assertIn("USD", usd_cad.comment.text)

    def test_the_auditor_columns_are_big_four_and_everyone_else(self):
        matrix = self.wb["A.02 Matrix"]
        self.assertEqual(matrix.cell(row=6, column=37).value, "Ernst & Young")
        self.assertIsNone(matrix.cell(row=6, column=38).value)
        self.assertIsNone(matrix.cell(row=7, column=37).value)
        self.assertEqual(matrix.cell(row=7, column=38).value, "Davidson & Company")

    def test_the_tier_is_filled_and_carries_its_rule(self):
        tier = self.wb["A.02 Matrix"].cell(row=6, column=2)
        self.assertEqual(tier.value, "Tier 1")
        self.assertEqual(tier.fill.fgColor.rgb[-6:], "86BC25", "a tier reads as a conclusion")
        self.assertTrue(tier.font.bold)

    def test_every_data_sheet_is_navigable_and_printable(self):
        for title in ["A.02 Matrix", "B.01 Consol TSX - TSXV", "B.04 Auditor & Fees"]:
            ws = self.wb[title]
            self.assertTrue(ws.freeze_panes, "%s does not hold its headers" % title)
            self.assertTrue(ws.auto_filter.ref, "%s cannot be filtered" % title)
            self.assertTrue(ws.print_title_rows, "%s loses its header on page 2" % title)
            self.assertEqual(ws.page_setup.orientation, "landscape")
            self.assertEqual(ws.sheet_properties.tabColor.rgb[-6:].upper() in
                             {"86BC25", "A7CF5E", "C6E29A"}, True)

    def test_no_tab_is_empty_and_contents_says_what_each_holds(self):
        for ws in self.wb.worksheets:
            filled = sum(1 for row in ws.iter_rows() for c in row if c.value not in (None, ""))
            self.assertGreater(filled, 0, "%s has nothing on it" % ws.title)
        contents = "\n".join(str(c.value) for row in self.wb["Contents"].iter_rows() for c in row)
        for title in self.wb.sheetnames:
            if title != "Contents":
                self.assertIn(title, contents, "%s is not listed in Contents" % title)

    def test_the_provenance_says_what_the_fees_are_and_what_was_not_converted(self):
        text = "\n".join(str(c.value) for row in self.wb["Provenance"].iter_rows() for c in row)
        self.assertIn("CAD, USD", text)
        self.assertIn("unconverted", text)


class SummaryPage(unittest.TestCase):
    """The page a partner opens. Its numbers have to be the matrix's numbers."""

    @classmethod
    def setUpClass(cls):
        cls.wb = load_workbook(io.BytesIO(workbook_bytes(_payload_with_fees())))
        cls.ws = cls.wb["Summary"]
        cls.cells = {c.coordinate: c.value for row in cls.ws.iter_rows() for c in row
                     if c.value is not None}

    def _formulas(self):
        return [v for v in self.cells.values() if isinstance(v, str) and v.startswith("=")]

    def test_every_range_covers_the_data_rows_and_no_others(self):
        # The defect this file exists to correct was a count that began one row
        # below the data. Two companies here: rows 6 and 7, nothing else.
        import re
        ranges = set()
        for formula in self._formulas():
            ranges.update(re.findall(r"\$[A-Z]{1,2}\$(\d+):\$[A-Z]{1,2}\$(\d+)", formula))
        self.assertTrue(ranges, "the summary has no ranges at all")
        for first, last in ranges:
            self.assertEqual((int(first), int(last)), (6, 7),
                             "a range does not cover exactly the two data rows")

    def test_every_share_is_a_share_of_the_population(self):
        shares = [v for k, v in self.cells.items()
                  if k.startswith("D") and isinstance(v, str) and v.startswith("=IF($C$")]
        self.assertGreaterEqual(len(shares), 10)
        for formula in shares:
            self.assertIn("$C$6", formula, "a share divides by something other than the total")

    def test_the_ranking_is_the_companies_deloitte_does_not_audit(self):
        names, caps = [], []
        for row in self.ws.iter_rows(min_col=2, max_col=5):
            if row[0].row > 28 and isinstance(row[0].value, str) and isinstance(row[3].value, (int, float)):
                names.append(row[0].value)
                caps.append(row[3].value)
        self.assertEqual(names, ["Agnico Eagle Mines Limited", "Elemental Royalty Corporation"])
        self.assertEqual(caps, sorted(caps, reverse=True), "largest first, or it is not a ranking")

    def test_it_says_what_research_is_still_missing(self):
        text = "\n".join(str(v) for v in self.cells.values())
        self.assertIn("no stage researched", text)
        self.assertIn("no audit fee", text)
        # And it says where "not audited by Deloitte" comes from, since the
        # firm's own client list is out of scope for this build.
        self.assertIn("not stored in this build", text)

"""Tests for the Excel export.

The end-to-end tests drive the real pipeline over the SYNTHETIC fixture --
parse, commit, export -- so nothing here depends on the licensed workbook.
"""
from __future__ import annotations

import csv
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import warnings  # noqa: E402
warnings.filterwarnings("ignore")
from openpyxl import load_workbook  # noqa: E402

from mmparser.export import (EXCHANGE_NOTICE, INTERNAL_USE, VENDOR_NOTICE,  # noqa: E402
                             MATRIX_FIRST_DATA_ROW, export_period)
from mmparser.xlsxwrite import (MAX_STRING, audit_sheet, needs_quote_prefix,  # noqa: E402
                                put, sanitize)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "synthetic_whitespace.xlsx")

# Functions Excel gained after 2007. A headless recalculation must stay viable
# as an automated check on the export, so none of these may appear.
MODERN = re.compile(
    r"\b(XLOOKUP|LET|LAMBDA|FILTER|SORTBY|UNIQUE|TEXTJOIN|IFS|SEQUENCE|"
    r"SWITCH|MAXIFS|MINIFS|CONCAT|TEXTSPLIT|VSTACK)\s*\(", re.I)


class InjectionGuard(unittest.TestCase):
    def setUp(self):
        from openpyxl import Workbook
        self.wb = Workbook()
        self.ws = self.wb.active

    def test_every_interpretable_prefix_is_flagged(self):
        for i, value in enumerate(["=1+1", "+SUM(A1)", "-2", "@risk note",
                                   "\tstarts with tab", "\rstarts with cr"], start=1):
            cell = put(self.ws, i, 1, value)
            self.assertTrue(
                cell.quotePrefix or not needs_quote_prefix(cell.value),
                "%r must not be left interpretable" % value)

    def test_the_flag_is_lossless(self):
        # Prefixing an apostrophe into the value would corrupt the legitimate
        # @-prefixed date labels present in the source.
        cell = put(self.ws, 1, 1, "@risk note")
        self.assertEqual(cell.value, "@risk note")
        self.assertTrue(cell.quotePrefix)

    def test_application_authored_formulas_still_evaluate(self):
        cell = put(self.ws, 1, 1, '=COUNTA(A1:A9)', formula=True)
        self.assertEqual(cell.value, "=COUNTA(A1:A9)")
        self.assertFalse(cell.quotePrefix)

    def test_a_data_value_can_never_become_a_formula(self):
        # formula=True is never set from data, and refuses a non-formula string.
        with self.assertRaises(ValueError):
            put(self.ws, 1, 1, "not a formula", formula=True)

    def test_control_characters_are_stripped_and_length_capped(self):
        self.assertEqual(sanitize("a\x00b\x07c"), "abc")
        long = "x" * (MAX_STRING + 500)
        self.assertLessEqual(len(sanitize(long)), MAX_STRING)
        self.assertTrue(sanitize(long).endswith("[truncated]"))

    def test_non_strings_pass_through_untouched(self):
        self.assertEqual(sanitize(42), 42)
        self.assertIsNone(sanitize(None))


def _build_export(tmp):
    """Parse the synthetic fixture, commit it, export it."""
    payload = os.path.join(tmp, "period.json")
    db = os.path.join(tmp, "period.db")
    xlsx = os.path.join(tmp, "out.xlsx")
    flat = os.path.join(tmp, "out.csv")

    subprocess.check_call(
        [sys.executable, "-m", "mmparser.cli", FIXTURE, "--json", payload],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.check_call(
        ["node", "scripts/commit_period.mjs", payload, db, "--fresh"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    export_period(db, xlsx, flat)
    return xlsx, flat


@unittest.skipIf(shutil.which("node") is None,
                 "node is required to commit a period before exporting")
class ExportEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="mm-export-")
        cls.xlsx, cls.csv = _build_export(cls.tmp)
        cls.wb = load_workbook(cls.xlsx)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_the_template_has_the_sheets_the_design_specifies(self):
        names = self.wb.sheetnames
        for sheet in ["Cover", "A - Analysis >>", "A.02 Matrix",
                      "B - Supporting Schedules >>", "B.01 Consol TSX - TSXV",
                      "B.04 Auditor & Fees", "Provenance"]:
            self.assertIn(sheet, names)
        # The pursuit tab is empty in the source and out of scope.
        self.assertNotIn("A.03 Selected Targets", names)

    def test_no_cell_anywhere_is_left_interpretable(self):
        offenders = []
        for ws in self.wb.worksheets:
            offenders += audit_sheet(ws)
        self.assertEqual(offenders, [], "unguarded interpretable strings: %r" % offenders[:5])

    def test_no_function_newer_than_the_2007_vocabulary(self):
        hits = []
        for ws in self.wb.worksheets:
            for row in ws.iter_rows():
                for cell in row:
                    v = cell.value
                    if isinstance(v, str) and v.startswith("=") and MODERN.search(v):
                        hits.append((ws.title, cell.coordinate, v[:60]))
        self.assertEqual(hits, [], "modern functions block headless recalculation: %r" % hits)

    def test_proof_ranges_start_at_the_first_data_row_and_carry_no_constant(self):
        ws = self.wb["A.02 Matrix"]
        formulas = [c.value for row in ws.iter_rows() for c in row
                    if isinstance(c.value, str) and c.value.startswith("=")]
        counts = [f for f in formulas if f.startswith(("=COUNTIF(", "=COUNTA("))]
        self.assertTrue(counts, "the proof block must contain count formulas")

        for f in counts:
            m = re.search(r"\(([A-Z]+)(\d+):([A-Z]+)(\d+)", f)
            if not m:
                continue
            start, end = int(m.group(2)), int(m.group(4))
            # The source's counts began one row BELOW the data, silently
            # dropping the first company.
            self.assertEqual(start, MATRIX_FIRST_DATA_ROW,
                             "range starts at row %d, not the first data row: %s" % (start, f))
            self.assertGreater(end, start)
            # ...and a hard-coded +1 restored the total while attributing the
            # dropped company to an exchange with no members.
            self.assertNotIn("+1", f, "compensating constant reintroduced: %s" % f)

    def test_the_count_ranges_actually_cover_every_data_row(self):
        """Range arithmetic, evaluated against the sheet's own data.

        openpyxl cannot recalculate and no headless engine is available here,
        so this recomputes the COUNTIF/COUNTA ranges directly rather than
        asserting the formulas are merely well-formed.
        """
        ws = self.wb["A.02 Matrix"]
        names = [ws.cell(row=r, column=4).value
                 for r in range(MATRIX_FIRST_DATA_ROW, ws.max_row + 1)]
        population = len([n for n in names if n])

        for row in ws.iter_rows():
            for cell in row:
                v = cell.value
                if not isinstance(v, str) or not v.startswith("=COUNTA(D"):
                    continue
                m = re.search(r"=COUNTA\(D(\d+):D(\d+)\)", v)
                self.assertIsNotNone(m)
                start, end = int(m.group(1)), int(m.group(2))
                covered = sum(
                    1 for r in range(start, end + 1)
                    if ws.cell(row=r, column=4).value)
                self.assertEqual(covered, population,
                                 "the company count range misses %d rows"
                                 % (population - covered))
                return
        self.fail("no company-count formula found in the proof block")

    def test_tier_counts_and_exchange_counts_both_reconcile_to_the_population(self):
        ws = self.wb["A.02 Matrix"]
        last = ws.max_row
        tiers, exchanges, names = {}, {}, 0
        for r in range(MATRIX_FIRST_DATA_ROW, last + 1):
            name = ws.cell(row=r, column=4).value
            if not name:
                continue
            names += 1
            tiers[ws.cell(row=r, column=2).value] = tiers.get(
                ws.cell(row=r, column=2).value, 0) + 1
            exchanges[ws.cell(row=r, column=5).value] = exchanges.get(
                ws.cell(row=r, column=5).value, 0) + 1
        self.assertEqual(sum(tiers.values()), names)
        self.assertEqual(sum(exchanges.values()), names)
        self.assertTrue(set(exchanges) <= {"TSX", "TSXV"}, exchanges)

    def test_the_derived_footprint_emits_the_value_the_workbook_never_did(self):
        ws = self.wb["A.02 Matrix"]
        formula = ws.cell(row=MATRIX_FIRST_DATA_ROW, column=21).value
        self.assertTrue(formula.startswith("="))
        # The corrected else-branch: "no properties at all" is None, not
        # "Canada only". That defect files ~$146bn of market cap under a
        # footprint the companies do not have.
        self.assertIn('"None"', formula)
        self.assertLess(formula.index('"None"'), formula.index('"Canada only"'),
                        "the None branch must be tested before the else-branch")

    def test_the_client_column_is_present_but_blank_throughout(self):
        # POC scope: no Deloitte client information is stored or exported. The
        # header is retained so downstream column references stay stable.
        ws = self.wb["A.02 Matrix"]
        self.assertEqual(ws.cell(row=5, column=35).value, "Yes / No")
        values = [ws.cell(row=r, column=35).value
                  for r in range(MATRIX_FIRST_DATA_ROW, ws.max_row + 1)]
        self.assertTrue(all(v is None for v in values),
                        "client data must never be exported")

    def test_the_financial_metrics_block_is_omitted_entirely(self):
        # Omitted rather than exported empty: an empty block invites someone to
        # reattach a broken lookup.
        ws = self.wb["A.02 Matrix"]
        for column in (8, 9, 10, 11):
            self.assertIsNone(ws.cell(row=5, column=column).value)

    def test_no_broken_reference_survives_anywhere(self):
        for ws in self.wb.worksheets:
            for row in ws.iter_rows():
                for cell in row:
                    if isinstance(cell.value, str):
                        self.assertNotIn("#REF!", cell.value,
                                         "%s!%s" % (ws.title, cell.coordinate))

    def test_both_licence_notices_are_on_the_cover(self):
        text = " ".join(str(c.value) for row in self.wb["Cover"].iter_rows()
                        for c in row if c.value)
        self.assertIn(INTERNAL_USE, text)
        self.assertIn(EXCHANGE_NOTICE, text)
        self.assertIn(VENDOR_NOTICE, text)

    def test_the_cover_pre_answers_the_first_defect_report(self):
        text = " ".join(str(c.value) for row in self.wb["Cover"].iter_rows()
                        for c in row if c.value)
        self.assertIn("144 TSX", text)
        self.assertIn("counting error", text)

    def test_the_tier_cell_carries_its_rule_trace_as_a_comment(self):
        ws = self.wb["A.02 Matrix"]
        commented = [ws.cell(row=r, column=2)
                     for r in range(MATRIX_FIRST_DATA_ROW, ws.max_row + 1)
                     if ws.cell(row=r, column=2).comment is not None]
        self.assertTrue(commented, "the tier must carry its trace")
        self.assertIn("Rule:", commented[0].comment.text)

    def test_the_consolidated_spacer_column_is_reproduced(self):
        # Column 18 is unnamed in the source. Reproducing it keeps column
        # letters stable for anyone holding a downstream reference.
        ws = self.wb["B.01 Consol TSX - TSXV"]
        self.assertIsNone(ws.cell(row=7, column=18).value)
        self.assertEqual(ws.cell(row=7, column=19).value, "Properties in Canada?")

    def test_the_flat_csv_carries_the_notices_and_neutralises_prefixes(self):
        with open(self.csv, encoding="utf-8") as fh:
            head = [next(fh) for _ in range(3)]
        self.assertIn(INTERNAL_USE, head[0])
        self.assertIn("TSX Group", head[1])

        with open(self.csv, encoding="utf-8") as fh:
            rows = list(csv.DictReader(
                line for line in fh if not line.startswith("#")))
        self.assertTrue(rows)
        for row in rows:
            for value in row.values():
                if isinstance(value, str) and value:
                    # A CSV opened in Excel evaluates the same prefixes, and
                    # there is no quote-prefix flag to lean on.
                    self.assertFalse(
                        value.startswith(("=", "+", "@")),
                        "unneutralised prefix in the flat export: %r" % value)

    def test_the_export_reopens_without_loss(self):
        reopened = load_workbook(self.xlsx)
        self.assertEqual(reopened.sheetnames, self.wb.sheetnames)
        a = reopened["A.02 Matrix"]
        b = self.wb["A.02 Matrix"]
        self.assertEqual(a.max_row, b.max_row)
        self.assertEqual(
            a.cell(row=MATRIX_FIRST_DATA_ROW, column=4).value,
            b.cell(row=MATRIX_FIRST_DATA_ROW, column=4).value)


if __name__ == "__main__":
    unittest.main(verbosity=2)

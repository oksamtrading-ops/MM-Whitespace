"""Unit tests for the parser. Runs against the synthesised fixture only.

    python3 -m unittest discover -s tests -v

The real workbook is never a fixture (licence + personal data), so nothing here
depends on reference/ existing. The parity check in scripts/ covers the real
file and runs separately.
"""
from __future__ import annotations

import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mmparser.aliases import HEADER_ALIASES, canonical_firm
from mmparser.ingest import ingest
from mmparser.safety import Finding
from mmparser.sentinels import (BLANK, FORMULA_ZERO, NOT_APPLICABLE, NOT_FOUND,
                                absent, resolve)
from mmparser.textnorm import clean_text, normalise_header
from mmparser.workbook import ColumnMap, Column

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "fixtures", "synthetic_whitespace.xlsx")


def _build_fixture_if_missing():
    if not os.path.exists(FIXTURE):
        subprocess.check_call([sys.executable,
                               os.path.join(os.path.dirname(FIXTURE), "build_fixture.py")])


class HeaderNormalisation(unittest.TestCase):
    def test_step_1_absent_header(self):
        self.assertFalse(normalise_header(None).present)
        self.assertFalse(normalise_header("   ").present)

    def test_steps_3_to_5_fold_newlines_and_trailing_space(self):
        self.assertEqual(normalise_header("Root\nTicker").slug, "root ticker")
        self.assertEqual(normalise_header("Fees in CAD ").slug,
                         normalise_header("Fees in CAD").slug)

    def test_step_6_captures_and_strips_a_full_date(self):
        h = normalise_header(" Market Cap (C$)\n31-May-2026 ")
        self.assertEqual(h.as_of, "2026-05-31")
        self.assertNotIn("2026", h.slug)

    def test_step_6_records_a_bare_year_without_stripping_it(self):
        # "2025 TSX30" and "2026 Venture 50" are index names. Stripping the year
        # would fold two distinct columns onto one key.
        h = normalise_header("2025 TSX30")
        self.assertEqual(h.as_of_year, 2025)
        self.assertIn("2025", h.slug)

    def test_step_7_folds_divergent_punctuation(self):
        self.assertEqual(normalise_header("Sub\nSector").slug,
                         normalise_header("Sub-Sector").slug)

    def test_step_8_alias_table_folds_wordings_slugging_cannot(self):
        a = normalise_header("Marketcap\n(in CAD)", HEADER_ALIASES).slug
        b = normalise_header("Market Capitalization \n(CAD $)", HEADER_ALIASES).slug
        c = normalise_header(" Market Cap (C$)\n31-May-2026 ", HEADER_ALIASES).slug
        self.assertEqual(a, b)
        self.assertEqual(b, c)

    def test_apostrophes_elide_rather_than_split_a_word(self):
        # Regression: an apostrophe replaced by a space produced the slug
        # "company s website", so the column never resolved and 45 page-titles
        # in the real file went unreported.
        self.assertEqual(normalise_header("Company's Website").slug, "companys website")
        self.assertEqual(normalise_header("Company\u2019s Website").slug, "companys website")

    def test_clean_text_runs_before_any_comparison(self):
        self.assertEqual(clean_text("Not found "), "Not found")


class Sentinels(unittest.TestCase):
    def test_the_six_forms(self):
        self.assertEqual(resolve(None).reason, BLANK)
        self.assertEqual(resolve("").reason, BLANK)
        self.assertEqual(resolve("Not found").reason, NOT_FOUND)
        self.assertEqual(resolve("Not found ").reason, NOT_FOUND)   # trim first
        self.assertEqual(resolve("N/A").reason, NOT_APPLICABLE)
        self.assertEqual(resolve(0, zero_is_sentinel=True).reason, FORMULA_ZERO)

    def test_zero_is_a_figure_outside_the_formula_columns(self):
        self.assertTrue(resolve(0).present)
        self.assertEqual(resolve(0).value, "0")

    def test_absent_column_asserts_nothing(self):
        self.assertFalse(absent().asserts_absence)
        self.assertTrue(resolve(None).asserts_absence)
        self.assertTrue(resolve("Not found").asserts_absence)


class AuditorVocabulary(unittest.TestCase):
    def test_trailing_space_collision_folds(self):
        self.assertEqual(canonical_firm("Grant Thornton "), canonical_firm("Grant Thornton"))

    def test_two_spellings_of_one_firm_fold(self):
        self.assertEqual(canonical_firm("EY (Ernst & Young)"), canonical_firm("Ernst & Young"))

    def test_firm_class_belongs_to_the_firm_not_the_column(self):
        # MNP sits in the Big-4 column once and the Others column nine times.
        self.assertEqual(canonical_firm("MNP")[1], "national")

    def test_other_is_not_a_firm_and_not_unknown(self):
        name, klass = canonical_firm("Other")
        self.assertEqual(name, "__other_unnamed__")
        self.assertIsNone(klass)
        self.assertIsNone(canonical_firm("Some Unlisted LLP"))


class CompoundColumnKey(unittest.TestCase):
    """Four header names appear twice on the matrix; a name-keyed dictionary
    silently collapses audit fees onto tax fees."""

    def _map(self):
        findings = []
        cols = [
            Column(40, "AN", "audit fees ( avantis platform)", "currency", "Currency", None),
            Column(45, "AS", "tax fees paid to audit firm ( avantis)", "currency", "Currency", None),
        ]
        return ColumnMap(cols, findings), findings

    def test_ambiguous_lookup_without_a_group_is_blocking(self):
        cmap, findings = self._map()
        self.assertIsNone(cmap.get("currency"))
        self.assertTrue(any(f.code == "ambiguous_column" for f in findings))

    def test_group_disambiguates(self):
        cmap, _ = self._map()
        audit = cmap.get("currency", "audit fees ( avantis platform)")
        tax = cmap.get("currency", "tax fees paid to audit firm ( avantis)")
        self.assertIsNotNone(audit)
        self.assertIsNotNone(tax)
        self.assertNotEqual(audit.index, tax.index)


class FixtureEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _build_fixture_if_missing()
        cls.companies, cls.report = ingest(FIXTURE)

    def _codes(self, kind):
        return [f.code for f in self.report[kind]]

    def test_parses_without_blocking_findings(self):
        self.assertEqual(self.report["blocking"], [], self.report["blocking"])

    def test_population_and_period(self):
        self.assertEqual(len(self.companies), 8)
        self.assertEqual(self.report["period"], "2026-05-31")

    def test_every_proof_total_ties(self):
        for label, (actual, expected) in self.report["proofs"]["totals"].items():
            self.assertEqual(actual, expected, label)

    def test_sub_threshold_hidden_rows_are_read_and_the_criterion_reported(self):
        filters = [f for f in self.report["warnings"] if f.code == "source_filter"]
        self.assertEqual(len(filters), 2)
        self.assertIn("greaterThanOrEqual 200000000", filters[0].detail)
        self.assertIn("hidden by it and were read anyway", filters[0].detail)

    def test_region_present_only_in_the_consolidated_list_is_carried_forward(self):
        carried = [f for f in self.report["warnings"] if f.code == "region_carried_forward"]
        self.assertEqual(len(carried), 1)
        self.assertIn("Carryco", carried[0].detail)
        company = self.companies[("CARY", "TSXV")]
        self.assertEqual(company["regions"]["CANADA"], ["NT"])
        self.assertEqual(company["region_provenance"]["CANADA"], "analyst_retained")

    def test_deloitte_client_column_is_positively_excluded_and_named(self):
        excluded = [f for f in self.report["info"] if f.code == "column_excluded_by_scope"]
        self.assertEqual(len(excluded), 1, "the client column must be named, not silently absent")
        self.assertIn("out of POC scope", excluded[0].detail)
        for company in self.companies.values():
            self.assertNotIn("tax_client", company)

    def test_free_text_other_properties_is_not_coerced_to_a_boolean(self):
        expl = self.companies[("EXPL", "TSXV")]
        self.assertIn("Cobalt", expl["commodities"])
        self.assertIn("Graphite", expl["commodities"])

    def test_a_company_with_no_properties_is_flagged_rather_than_called_canadian(self):
        royalco = self.companies[("ROYL", "TSX")]
        self.assertEqual(royalco["property_evidence"], "none")
        self.assertTrue(any(f.code == "no_properties" and "Royalco" in f.detail
                            for f in self.report["warnings"]))

    def test_website_page_titles_are_flagged_not_stored_as_urls(self):
        self.assertTrue(any(f.code == "website_is_title" for f in self.report["warnings"]))

    def test_empty_divider_sheets_are_skipped_silently(self):
        not_ingested = [f.detail for f in self.report["info"] if f.code == "sheet_not_ingested"]
        self.assertFalse(any(">>" in d for d in not_ingested),
                         "empty dividers must not be reported as data-bearing")


if __name__ == "__main__":
    unittest.main(verbosity=2)

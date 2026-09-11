import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currencyCode, formatFieldValue, formatMoney, parseFieldInput, parseMoney, parseStages,
} from "./fields.ts";

test("money always says which dollar, with thousands separators", () => {
  assert.equal(formatMoney(1_060_201_462, "CAD"), "C$1,060,201,462");
  assert.equal(formatMoney(517_116, "USD"), "US$517,116");
  assert.equal(formatMoney(12_000, "EUR"), "€12,000");
  assert.equal(formatMoney(12_000, "CHF"), "CHF 12,000");
  assert.equal(formatMoney(0.42, "USD", { cents: true }), "US$0.42");
  assert.equal(formatMoney(5, "USD", { cents: true }), "US$5.00");
  assert.equal(formatMoney(200_000_000, "CAD", { compact: true }), "C$200M");
  assert.equal(formatMoney(1_234.5, "CAD"), "C$1,234.50");
  assert.ok(!/^\$/.test(formatMoney(1, "CAD")), "never a bare $ for Canadian dollars");
});

test("currency names reduce to codes; a bare $ is not one", () => {
  for (const [raw, code] of [["C$", "CAD"], ["CDN$", "CAD"], ["Canadian dollars", "CAD"], ["US$", "USD"],
                             ["U.S. dollars", "USD"], ["usd", "USD"], ["€", "EUR"], ["£", "GBP"], ["A$", "AUD"]]) {
    assert.equal(currencyCode(raw), code, raw);
  }
  assert.equal(currencyCode("$"), null);
  assert.equal(currencyCode(null), null);
});

test("fees read with currency and year, and say when the currency was never recorded", () => {
  assert.equal(formatFieldValue("audit_fee", { amount: 8_052_000, currency: "CAD", fiscal_year: 2025 }),
               "C$8,052,000 (FY2025)");
  assert.equal(formatFieldValue("audit_fee", { amount: 517_116, currency: "USD", fiscal_year: null }), "US$517,116");
  assert.equal(formatFieldValue("tax_fee", { amount: 0, currency: "USD", fiscal_year: 2025 }), "US$0 (FY2025)");
  // Run 1's fees were stored as bare numbers before currency was kept.
  assert.equal(formatFieldValue("audit_fee", 353_190), "353,190 (currency not recorded)");
});

test("a fee typed in any ordinary way is read, and one without a currency is refused", () => {
  const money = (t: string) => { const p = parseMoney(t); assert.ok(p.ok, t); return p.value; };
  assert.deepEqual(money("C$353,190 (FY2024)"), { amount: 353_190, currency: "CAD", fiscal_year: 2024 });
  assert.deepEqual(money("US$ 517,116"), { amount: 517_116, currency: "USD", fiscal_year: null });
  assert.deepEqual(money("1,200 CAD"), { amount: 1_200, currency: "CAD", fiscal_year: null });
  assert.deepEqual(money("nil US$ FY2025"), { amount: 0, currency: "USD", fiscal_year: 2025 });
  assert.deepEqual(money("C$8.052 million"), { amount: 8_052_000, currency: "CAD", fiscal_year: null });
  const bare = parseMoney("$353,190");
  assert.equal(bare.ok, false);
  assert.match(!bare.ok ? bare.message : "", /bare \$/);
  assert.equal(parseMoney("353190").ok, false, "a number alone does not say which currency");
  assert.equal(parseMoney("about four hundred").ok, false);
  assert.equal(parseMoney("353,190 (currency not recorded)").ok, false, "a legacy value must be given a currency");
});

test("the stage reads as words and is edited as words", () => {
  const radisson = { exploration: true, development: true, production: false, royalty_streaming: true };
  assert.equal(formatFieldValue("stage_evidence_state", radisson), "exploration + development + royalty streaming");
  // Run 1: deleting the last stage from the box must set exactly the others.
  const edited = parseStages("exploration + development");
  assert.deepEqual(edited.ok && edited.value,
                   { exploration: true, development: true, production: false, royalty_streaming: false });
  assert.deepEqual((parseStages("Production, exploration and royalty") as { value: unknown }).value,
                   { exploration: true, development: false, production: true, royalty_streaming: true });
  // Text that names no stage is refused rather than stored and read as "no stage".
  const wrong = parseStages("exploration + mining");
  assert.equal(wrong.ok, false);
  assert.match(!wrong.ok ? wrong.message : "", /"mining" is not a stage/);
  assert.equal(parseStages("").ok, false);
  // The stored state reads as a word, not a lowercase code.
  assert.equal(formatFieldValue("stage_evidence_state", "complete"), "Complete");
});

test("every field's display parses back to the value it came from", () => {
  const cases: Array<[string, unknown]> = [
    ["audit_fee", { amount: 8_052_000, currency: "CAD", fiscal_year: 2025 }],
    ["tax_fee", { amount: 0, currency: "USD", fiscal_year: 2025 }],
    ["audit_fee", { amount: 517_116, currency: "USD", fiscal_year: null }],
    ["market_cap_cad", 888_608_691],
    ["stage_evidence_state", { exploration: true, development: true, production: false, royalty_streaming: false }],
    ["stage_evidence_state", { exploration: false, development: false, production: true, royalty_streaming: true }],
    ["fiscal_year_end", "12-31"],
    ["fiscal_year_end", "06-30"],
    ["auditor_since", 2017],
    ["sec_registrant", { registrant: true, form: "40-F", cik: "1649752" }],
    ["sec_registrant", { registrant: false, form: null, cik: null }],
    ["auditor_change", { changed: false, date: null, previous_auditor: null }],
    ["auditor_change", { changed: true, date: "2025-06", previous_auditor: "Grant Thornton" }],
    ["property_regions", { CANADA: ["QC", "ON"], USA: ["NV"], "LATIN AMERICA": [], "UK/EUROPE": [],
                           AFRICA: [], ASIA: [], "AUS/NZ/PNG": ["Fiji"], OTHER: [] }],
    ["commodities", ["Gold", "Copper"]],
    ["venture_graduate", false],
    ["website", "https://nmg.com"],
    ["auditor", "PwC"],
    ["head_office_location", "Saint-Michel-des-Saints"],
  ];
  for (const [key, value] of cases) {
    const shown = formatFieldValue(key, value);
    const back = parseFieldInput(key, shown);
    assert.ok(back.ok, `${key}: "${shown}" did not parse back: ${!back.ok ? back.message : ""}`);
    assert.deepEqual(back.value, value, `${key}: "${shown}"`);
  }
});

test("dates, years and addresses are written the way people write them", () => {
  assert.equal(formatFieldValue("fiscal_year_end", "12-31"), "31 December");
  for (const t of ["31 December", "December 31", "Dec 31", "12-31", "12/31"]) {
    assert.deepEqual(parseFieldInput("fiscal_year_end", t), { ok: true, value: "12-31" }, t);
  }
  assert.equal(parseFieldInput("fiscal_year_end", "31 February").ok, false);
  assert.equal(formatFieldValue("auditor_since", 2017), "2017", "a year is not 2,017");
  assert.equal(parseFieldInput("auditor_since", "twenty").ok, false);
  assert.deepEqual(parseFieldInput("website", "nmg.com"), { ok: true, value: "https://nmg.com" });
  assert.equal(parseFieldInput("market_cap_cad", "US$1,000").ok, false, "market cap is Canadian dollars");
  assert.equal(formatFieldValue("market_cap_cad", 1_060_201_462), "C$1,060,201,462");
});

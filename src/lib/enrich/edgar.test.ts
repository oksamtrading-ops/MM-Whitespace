import { test } from "node:test";
import assert from "node:assert/strict";
import { edgarFindings, parseSubmissions, registrationOf } from "./edgar.ts";
import type { FetchedDocument } from "./fetch.ts";

/** EDGAR's submissions record, newest filing first, as data.sec.gov serves it. */
function submissions(cik: string, filings: Array<[form: string, date: string]>): string {
  return JSON.stringify({
    cik, name: "NORTHCO MINING CORP", fiscalYearEnd: "1231",
    addresses: { business: { city: "VANCOUVER", stateOrCountry: "A1", stateOrCountryDescription: "BRITISH COLUMBIA, CANADA" } },
    filings: { recent: {
      form: filings.map((f) => f[0]), filingDate: filings.map((f) => f[1]),
      accessionNumber: filings.map((_, i) => `0000000000-26-${String(i).padStart(6, "0")}`),
      primaryDocument: filings.map((_, i) => `d${i}.htm`),
    } },
  });
}

function registrant(text: string) {
  const doc = { contentHash: "sha256:x", finalUrl: "https://data.sec.gov/submissions/CIK1.json", text } as FetchedDocument;
  const f = edgarFindings(parseSubmissions(text), doc).find((x) => x.field_key === "sec_registrant")!;
  return { value: f.value as { registrant: boolean; form: string | null; cik: string }, quote: f.evidence_excerpt };
}

test("a company that files annual reports is a registrant, under the form it files", () => {
  assert.deepEqual(registrant(submissions("2809", [["6-K", "2026-10-01"], ["40-F", "2026-03-20"]])).value,
                   { registrant: true, form: "40-F", cik: "2809" });
  assert.deepEqual(registrant(submissions("215466", [["8-K", "2026-09-01"], ["10-Q", "2026-08-01"], ["10-K", "2026-02-20"]])).value,
                   { registrant: true, form: "10-K", cik: "215466" });
});

test("FORM D IS NOT REGISTRATION: a CIK for a private placement makes nobody an SEC registrant", () => {
  // Copper Giant, K2 Gold, PPX Mining, Scottie Resources in Run 3: all proposed
  // as registrants at evidence 0.88, because EDGAR had a record of them.
  const r = registrant(submissions("1580110", [["D", "2026-05-02"], ["D/A", "2025-11-14"], ["D", "2025-04-01"]]));
  assert.deepEqual(r.value, { registrant: false, form: null, cik: "1580110" });
  assert.match(r.quote!, /"cik"/);
});

test("an ADR depositary's filings and a takeover's are not the company reporting either", () => {
  // Paladin and Alkane (F-6 from the depositary), First Quantum (425, CB, F-80).
  assert.equal(registrationOf({ form: ["F-6 POS", "F-6 POS", "F-X", "CB", "D"], filingDate: [] }).status, "never");
  assert.equal(registrationOf({ form: ["SC 13G/A", "F-80/A", "425", "F-80"], filingDate: [] }).status, "never");
});

test("a section-12 registration counts before the first annual report", () => {
  // Gunnison Copper and Black Mammoth registered on Form 40-F in 2026.
  assert.deepEqual(registrant(submissions("1514860", [["CERT", "2026-07-02"], ["40FR12B", "2026-07-01"], ["F-X", "2026-06-20"], ["D", "2025-01-10"]])).value,
                   { registrant: true, form: "40-F", cik: "1514860" });
  assert.deepEqual(registrationOf({ form: ["20FR12G"], filingDate: ["2026-01-05"] }), { status: "registered", form: "20-F" });
});

test("ARRAS: a Form 15 with nothing periodic after it ends the registration, whatever came before", () => {
  const text = submissions("1855743", [["D", "2026-07-16"], ["D", "2025-04-23"], ["15-12G", "2024-10-22"],
                                       ["6-K", "2024-09-27"], ["20-F", "2024-02-28"]]);
  assert.deepEqual(registrationOf(JSON.parse(text).filings.recent), { status: "terminated", form: "15-12G", filed: "2024-10-22" });
  const r = registrant(text);
  assert.deepEqual(r.value, { registrant: false, form: null, cik: "1855743" });
  assert.equal(r.quote, '"15-12G"', "the quote is the form that ended it, so the reviewer sees why");
  // The 20-F is still the latest annual report, for pass 2 to read.
  assert.equal(parseSubmissions(text).latestAnnual?.form, "20-F");
});

test("a Form 15 for one class does not end the company's reporting while reports go on", () => {
  // Deregistering warrants, say, and filing 6-Ks and the 40-F after it.
  assert.deepEqual(registrationOf({ form: ["6-K", "40-F", "15-12G", "6-K", "40-F"], filingDate: [] }),
                   { status: "registered", form: "40-F" });
  // And a foreign private issuer's exit by Form 15F, with no report after it.
  assert.equal(registrationOf({ form: ["15F-12B", "6-K", "40-F"], filingDate: ["2026-06-01", "2026-05-01", "2026-03-01"] }).status,
               "terminated");
});

test("a record with no filings at all is not a registrant", () => {
  assert.equal(registrationOf(undefined).status, "never");
  assert.equal(registrationOf({ form: [], filingDate: [] }).status, "never");
});

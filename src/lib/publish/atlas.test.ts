import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import { commitPeriod, type ParsedCompany } from "../db/commit.ts";
import { recordDecision } from "../review/decide.ts";
import { publishPeriod } from "./snapshot.ts";
import { canonicalFirm, readAtlas, type AtlasCompany } from "./atlas.ts";

function company(ordinal: number, name: string, over: Partial<ParsedCompany> = {}): ParsedCompany {
  return {
    ticker: `T${ordinal}`, exchange: "TSX", name, ordinal, market_cap: 5_000_000_000,
    stages: ["production"], stage_evidence: "complete", property_evidence: "complete",
    regions: { CANADA: ["ON"] }, region_provenance: { CANADA: "extract" },
    commodities: ["Gold"], venture_graduate: false,
    auditor: null, auditor_class: null, entity_id: null, website: null,
    tier_workbook: 2, footprint_workbook: "Canada only",
    ...over,
  } as ParsedCompany;
}

/** The internal labels the fixture gives the Deloitte market: none may reach the dashboard. */
const MARKETS = ["Prairies Region", "Atlantic", "Quebec & NCR"];

const periodOf = async (db: Sql, label: string) =>
  (await db.get("select id from periods where label = ?", label) as { id: string }).id;
const companyOf = async (db: Sql, name: string) =>
  (await db.get("select id from companies where canonical_name = ?", name) as { id: string }).id;

/** A researched value, entered the way review enters one research never reached: an override citing its page. */
async function research(db: Sql, periodId: string, name: string, fieldKey: string, value: unknown) {
  await recordDecision(db, {
    periodId, companyId: await companyOf(db, name), fieldKey, decision: "override", overrideValue: value,
    reason: "read from the 2026 circular https://example.com/circular.pdf",
  });
}

/**
 * Two published periods a year apart. Alpha and Middle continue, Leaver
 * leaves, three companies enter, and the second period's research is entered
 * in review before it is published.
 */
async function twoPeriods() {
  const db = memorySql();
  await commitPeriod(db, { period: "2025-08-31", companies: [
    company(1, "Alpha Gold Corp.", { market_cap: 3_000_000_000, auditor: "KPMG", dtt_market: "Prairies Region" }),
    company(2, "Middle Metals Inc.", { market_cap: 900_000_000, auditor: "MNP" }),
    company(3, "Leaver Mining Ltd.", { ticker: "LVR", market_cap: 700_000_000, auditor: "PwC", dtt_market: "Atlantic" }),
  ] }, { label: "P1" });
  const p1 = await periodOf(db, "P1");
  const pub1 = (await publishPeriod(db, p1, { overrideReason: "test" })).publicationId;

  await commitPeriod(db, { period: "2026-08-31", companies: [
    company(1, "Alpha Gold Corp.", {
      market_cap: 4_000_000_000, auditor: "Deloitte", dtt_market: "Quebec & NCR",
      regions: { CANADA: ["NWT", "BC"], USA: ["CA"], "LATIN AMERICA": ["Mexico"], OTHER: ["Atlantis"] },
      region_provenance: { CANADA: "extract", USA: "extract", "LATIN AMERICA": "extract", OTHER: "extract" },
      head_office_region: "British Columbia, Canada", commodities: ["Gold", "Copper"],
    }),
    // Two spellings of one territory are one place.
    company(2, "Middle Metals Inc.", {
      market_cap: 900_000_000, auditor: "MNP", regions: { CANADA: ["NT", "nwt"] },
      head_office_region: "Colorado, United States",
    }),
    company(4, "Davidson Client Corp.", {
      market_cap: 600_000_000, auditor: "Davidson & Company",
      regions: { "LATIN AMERICA": ["Chile"] }, region_provenance: { "LATIN AMERICA": "extract" },
      head_office_region: "Chile",
    }),
    company(5, "Unlisted Firm Corp.", { market_cap: 250_000_000, auditor: "Stern & Lovrics", head_office_region: "Canada" }),
    company(6, "Unknown Auditor Corp.", { market_cap: null, auditor: null, stages: [], stage_evidence: "none" }),
  ] }, { label: "P2" });
  const p2 = await periodOf(db, "P2");

  await research(db, p2, "Alpha Gold Corp.", "auditor_change", { changed: true, date: "2025-05", previous_auditor: "KPMG LLP" });
  await research(db, p2, "Alpha Gold Corp.", "sec_registrant", { registrant: true, form: "40-F", cik: 1234 });
  await research(db, p2, "Alpha Gold Corp.", "fiscal_year_end", "12-31");
  await research(db, p2, "Alpha Gold Corp.", "audit_fee", { amount: 1_250_000, currency: "CAD", fiscal_year: 2025 });
  await research(db, p2, "Alpha Gold Corp.", "auditor_since", 2025);
  await research(db, p2, "Alpha Gold Corp.", "head_office_location", "Vancouver");
  await research(db, p2, "Middle Metals Inc.", "auditor_change", { changed: false, date: null, previous_auditor: null });
  await research(db, p2, "Middle Metals Inc.", "sec_registrant", { registrant: false, form: null, cik: null });
  await research(db, p2, "Middle Metals Inc.", "fiscal_year_end", "December 31");
  await research(db, p2, "Middle Metals Inc.", "audit_fee", 90_000);
  await research(db, p2, "Middle Metals Inc.", "auditor_since", 2009);
  // The previous firm as the filing wrote it, matched to an incumbent's name in the snapshot.
  await research(db, p2, "Davidson Client Corp.", "auditor_change", { changed: true, date: null, previous_auditor: "Stern & Lovrics LLP" });

  const pub2 = (await publishPeriod(db, p2, { overrideReason: "test" })).publicationId;
  return { db, p1, p2, pub1, pub2 };
}

const byName = (cs: AtlasCompany[], name: string) => {
  const c = cs.find((x) => x.name === name);
  assert.ok(c, `${name} is on the dashboard`);
  return c;
};

test("every published company appears once, largest first, with its tier as published", async () => {
  const { db, p2, pub2 } = await twoPeriods();
  const atlas = await readAtlas(db, p2, pub2);

  const published = await db.all(`select company_id, tier, status, footprint, prior_tier
      from published_period_tiers where publication_id = ?`, pub2) as
    Array<{ company_id: string; tier: number | null; status: string; footprint: string; prior_tier: number | null }>;
  const ids = atlas.companies.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "no company twice");
  assert.deepEqual([...ids].sort(), published.map((p) => String(p.company_id)).sort());

  assert.deepEqual(atlas.companies.map((c) => c.name), [
    "Alpha Gold Corp.", "Middle Metals Inc.", "Davidson Client Corp.", "Unlisted Firm Corp.", "Unknown Auditor Corp.",
  ], "by market cap, the company with none last");
  for (const p of published) {
    const c = atlas.companies.find((x) => x.id === String(p.company_id))!;
    assert.equal(c.tier, p.tier, c.name);
    assert.equal(c.status, p.status, c.name);
    assert.equal(c.footprint, p.footprint, c.name);
    assert.equal(c.priorTier, p.prior_tier, c.name);
  }

  const alpha = byName(atlas.companies, "Alpha Gold Corp.");
  assert.equal(alpha.ticker, "T1");
  assert.equal(alpha.exchange, "TSX");
  assert.equal(alpha.cap, 4e9);
  assert.deepEqual(alpha.commodities, ["Gold", "Copper"]);
  assert.deepEqual(alpha.stages, ["production"]);
  const unknown = byName(atlas.companies, "Unknown Auditor Corp.");
  assert.equal(unknown.cap, null);
  assert.deepEqual(unknown.stages, [], "a revision with stage rows gives a company with none an empty list, not null");
  assert.equal(unknown.tier, null);

  const line = await db.get("select threshold_amount, threshold_currency, threshold_operator from periods where id = ?", p2) as
    { threshold_amount: number; threshold_currency: string; threshold_operator: string };
  assert.deepEqual(atlas.period, {
    id: p2, label: "P2", asOf: "2026-08-31", threshold: Number(line.threshold_amount),
    currency: line.threshold_currency, operator: line.threshold_operator,
  });
  assert.equal(atlas.period.threshold, 200_000_000, "the default line");
  assert.equal(atlas.publication.id, pub2);
  assert.equal(atlas.publication.revision, 1);
  assert.equal(atlas.publication.overrideReason, "test");
  assert.equal(atlas.publication.amendmentReason, null);
});

test("the Deloitte market is never read: not its key, not its value, anywhere in the dashboard's data", async () => {
  const { db, p2, pub2 } = await twoPeriods();
  const frozen = (await db.all(`select value from published_period_values
      where publication_id = ? and field_key = 'dtt_market'`, pub2) as Array<{ value: string }>).map((r) => r.value);
  assert.ok(frozen.some((v) => v.includes("Quebec & NCR")), "the fixture does publish one, so the check means something");

  const json = JSON.stringify(await readAtlas(db, p2, pub2));
  assert.ok(!json.includes("dtt_market"), "the key");
  for (const label of MARKETS) assert.ok(!json.includes(label), `the value "${label}"`);
});

test("places fold onto the globe's keys, a place the globe cannot draw is kept in words, and each key links back to its roster token", async () => {
  const { db, p2, pub2 } = await twoPeriods();
  const atlas = await readAtlas(db, p2, pub2);

  const alpha = byName(atlas.companies, "Alpha Gold Corp.");
  assert.deepEqual(alpha.places, ["CA:BC", "CA:NT", "Mexico", "US:CA"], "NWT is CA:NT; CA under USA is California");
  assert.deepEqual(alpha.unplaced, ["OTHER: Atlantis"]);
  assert.deepEqual(byName(atlas.companies, "Middle Metals Inc.").places, ["CA:NT"], "NT and nwt are one place, counted once");
  assert.deepEqual(byName(atlas.companies, "Davidson Client Corp.").places, ["Chile"]);
  assert.deepEqual(byName(atlas.companies, "Unknown Auditor Corp.").unplaced, []);

  assert.deepEqual(atlas.placeTokens, {
    "CA:BC": ["CANADA:BC"], "CA:NT": ["CANADA:NT"], "US:CA": ["USA:CA"], Mexico: ["LATIN AMERICA:Mexico"],
    Chile: ["LATIN AMERICA:Chile"], "CA:ON": ["CANADA:ON"],
  });
  assert.ok(!Object.values(atlas.placeTokens).flat().some((t) => t.includes("Atlantis")), "nothing links to a place that is not drawn");
});

test("a head office is a globe key where it names a province, a state or a country, and the roster's token either way", async () => {
  const { db, p2, pub2 } = await twoPeriods();
  const atlas = await readAtlas(db, p2, pub2);
  const hq = (name: string) => {
    const c = byName(atlas.companies, name);
    return [c.hq, c.hqToken, c.hqRegion, c.hqCity];
  };
  assert.deepEqual(hq("Alpha Gold Corp."), ["CA:BC", "CA:BC", "British Columbia, Canada", "Vancouver"]);
  assert.deepEqual(hq("Middle Metals Inc."), ["US:CO", "US:CO", "Colorado, United States", null]);
  assert.deepEqual(hq("Davidson Client Corp."), ["Chile", "Chile", "Chile", null]);
  assert.deepEqual(hq("Unlisted Firm Corp."), [null, "Canada", "Canada", null], "Canada alone has no province to stand on");
  assert.deepEqual(hq("Unknown Auditor Corp."), [null, null, null, null]);
});

test("a firm's class comes from the auditors table; a firm it does not list is 'other', and an unknown auditor has none", async () => {
  const { db, p2, pub2 } = await twoPeriods();
  const atlas = await readAtlas(db, p2, pub2);
  const cls = (name: string) => {
    const c = byName(atlas.companies, name);
    return [c.auditor, c.firmClass];
  };
  assert.deepEqual(cls("Alpha Gold Corp."), ["Deloitte", "big4"]);
  assert.deepEqual(cls("Middle Metals Inc."), ["MNP", "national"]);
  assert.deepEqual(cls("Davidson Client Corp."), ["Davidson & Company", "regional"]);
  assert.deepEqual(cls("Unlisted Firm Corp."), ["Stern & Lovrics", "other"]);
  assert.deepEqual(cls("Unknown Auditor Corp."), [null, null]);

  assert.equal(atlas.firmClasses.Deloitte, "big4");
  assert.equal(atlas.firmClasses.MNP, "national");
  assert.equal(atlas.firmClasses["Davidson & Company"], "regional");
  assert.ok(!("Stern & Lovrics" in atlas.firmClasses), "only the firms the table classifies");
});

test("researched facts read as the dashboard uses them, and a fact research has not found reads as not known", async () => {
  const { db, p2, pub2 } = await twoPeriods();
  const atlas = await readAtlas(db, p2, pub2);

  const alpha = byName(atlas.companies, "Alpha Gold Corp.");
  assert.deepEqual(alpha.change, { date: "2025-05", from: "KPMG" }, "the previous firm in the snapshot's own name");
  assert.equal(alpha.changeKnown, true);
  assert.equal(alpha.sec, true);
  assert.equal(alpha.secForm, "40-F");
  assert.equal(alpha.yearEnd, "12-31");
  assert.deepEqual(alpha.fee, { amount: 1_250_000, currency: "CAD", year: 2025 });
  assert.equal(alpha.since, 2025);

  const middle = byName(atlas.companies, "Middle Metals Inc.");
  assert.equal(middle.change, null, "research looked and found no change");
  assert.equal(middle.changeKnown, true);
  assert.equal(middle.sec, false);
  assert.equal(middle.secForm, null);
  assert.equal(middle.yearEnd, null, "\"December 31\" is not MM-DD");
  assert.deepEqual(middle.fee, { amount: 90_000, currency: null, year: null }, "a bare amount has no currency");
  assert.equal(middle.since, 2009);

  const davidson = byName(atlas.companies, "Davidson Client Corp.");
  assert.deepEqual(davidson.change, { date: null, from: "Stern & Lovrics" });

  const unlisted = byName(atlas.companies, "Unlisted Firm Corp.");
  assert.deepEqual([unlisted.change, unlisted.changeKnown, unlisted.sec, unlisted.secForm, unlisted.yearEnd, unlisted.fee, unlisted.since],
    [null, false, null, null, null, null, null]);
});

test("with two periods published: the prior period, its entrants and its leavers", async () => {
  const { db, p1, p2, pub2 } = await twoPeriods();
  const atlas = await readAtlas(db, p2, pub2);

  assert.deepEqual(atlas.prior, {
    id: p1, label: "P1", asOf: "2025-08-31", threshold: atlas.period.threshold, currency: "CAD", operator: "gte",
    revision: 1, companies: 3, capTotal: 3e9 + 9e8 + 7e8,
  });
  assert.deepEqual(byName(atlas.companies, "Alpha Gold Corp.").prior, { cap: 3e9, auditor: "KPMG" });
  assert.deepEqual(byName(atlas.companies, "Middle Metals Inc.").prior, { cap: 9e8, auditor: "MNP" });
  assert.deepEqual(atlas.companies.filter((c) => c.prior === null).map((c) => c.name),
    ["Davidson Client Corp.", "Unlisted Firm Corp.", "Unknown Auditor Corp."], "the entrants");
  assert.deepEqual(atlas.leavers, [
    { id: await companyOf(db, "Leaver Mining Ltd."), name: "Leaver Mining Ltd.", ticker: "LVR", cap: 7e8, auditor: "PwC" },
  ]);
});

test("the first period published has no prior, no entrants and no leavers", async () => {
  const { db, p1, pub1 } = await twoPeriods();
  const atlas = await readAtlas(db, p1, pub1);
  assert.equal(atlas.prior, null);
  assert.deepEqual(atlas.leavers, []);
  assert.ok(atlas.companies.every((c) => c.prior === null));
  assert.deepEqual(atlas.companies.map((c) => c.name), ["Alpha Gold Corp.", "Middle Metals Inc.", "Leaver Mining Ltd."]);
});

test("the prior is the newest revision of the period before: an amendment to it shows", async () => {
  const { db, p1, p2, pub2 } = await twoPeriods();
  await recordDecision(db, { periodId: p1, companyId: await companyOf(db, "Alpha Gold Corp."), fieldKey: "auditor",
                             decision: "override", overrideValue: "Ernst & Young", reason: "the 2025 circular" });
  await publishPeriod(db, p1, { overrideReason: "test", amendmentReason: "Alpha's auditor" });

  const atlas = await readAtlas(db, p2, pub2);
  assert.equal(atlas.prior?.revision, 2);
  assert.deepEqual(byName(atlas.companies, "Alpha Gold Corp.").prior, { cap: 3e9, auditor: "Ernst & Young" });
});

test("tier moves compare with the prior period's newest revision, as every other figure of the comparison does", async () => {
  const { db, p2, pub1, pub2 } = await twoPeriods();
  const alpha = await companyOf(db, "Alpha Gold Corp.");
  const frozen = await db.get("select prior_tier from published_period_tiers where publication_id = ? and company_id = ?", pub2, alpha) as
    { prior_tier: number | null };
  // What an amendment to the prior period leaves: its newest revision says other than the tier frozen with this one.
  await db.run("update published_period_tiers set tier = 6 where publication_id = ? and company_id = ?", pub1, alpha);
  const atlas = await readAtlas(db, p2, pub2);
  assert.notEqual(frozen.prior_tier, 6);
  assert.equal(byName(atlas.companies, "Alpha Gold Corp.").priorTier, 6);
});

test("a publication that is not a revision of the period is refused", async () => {
  const { db, p2, pub1 } = await twoPeriods();
  await assert.rejects(readAtlas(db, p2, pub1), /is not a revision of period/);
});

const KNOWN = ["Deloitte", "PwC", "KPMG", "Ernst & Young", "BDO", "Grant Thornton", "MNP", "Davidson & Company",
  "McGovern Hurley", "Crowe MacKay", "Kingston Ross Pasnak", "MS Partners", "D+H Group", "Zeifmans", "Smythe", "DNTW"];

test("canonicalFirm: a firm as a filing writes it, to the name the snapshot uses", () => {
  assert.equal(canonicalFirm("KPMG LLP", KNOWN), "KPMG");
  assert.equal(canonicalFirm("PricewaterhouseCoopers LLP", KNOWN), "PwC");
  assert.equal(canonicalFirm("Davidson & Company LLP", KNOWN), "Davidson & Company");
  assert.equal(canonicalFirm("Deloitte LLP", KNOWN), "Deloitte");
  assert.equal(canonicalFirm("EY", KNOWN), "Ernst & Young");
  assert.equal(canonicalFirm("Ernst & Young LLP", KNOWN), "Ernst & Young");
  assert.equal(canonicalFirm("Deloitte & Touche LLP", KNOWN), "Deloitte");
  assert.equal(canonicalFirm("KPMG LLP, Chartered Professional Accountants", KNOWN), "KPMG");
  assert.equal(canonicalFirm("BDO Canada LLP", KNOWN), "BDO", "a known firm followed by more words is that firm");
  assert.equal(canonicalFirm("  mnp llp ", KNOWN), "MNP");
  assert.equal(canonicalFirm("Davidson & Company", KNOWN), "Davidson & Company");
});

test("canonicalFirm: a firm it does not know comes back cleaned, never guessed", () => {
  assert.equal(canonicalFirm("Stern & Lovrics LLP", KNOWN), "Stern & Lovrics");
  assert.equal(canonicalFirm("Stern & Lovrics", KNOWN), "Stern & Lovrics");
  assert.equal(canonicalFirm("Crowe", KNOWN), "Crowe", "a part of a known name is not that firm");
  assert.equal(canonicalFirm("Stern & Lovrics LLP", [...KNOWN, "Stern & Lovrics"]), "Stern & Lovrics");
  assert.equal(canonicalFirm(null, KNOWN), null);
  assert.equal(canonicalFirm("", KNOWN), null);
  assert.equal(canonicalFirm("   ", KNOWN), null);
});

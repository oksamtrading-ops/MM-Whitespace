/**
 * Build the committed cassettes.
 *
 * These are SYNTHESISED recordings, not captured vendor responses. No call has
 * ever been made from this build: live mode is disabled pending the risk and
 * legal review under decision 1. They exist so the pipeline -- ledger, gate,
 * evidence scoring, persistence -- can be exercised end to end with no key and
 * no network, which is what replay mode is for.
 *
 * Companies here are the fabricated ones from the synthetic fixture. No real
 * issuer, and no real filing text, appears in this directory.
 *
 *   node tests/cassettes/build_cassettes.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applySchema } from "../../src/lib/db/schema.ts";
import { buildPrompt, PROMPT_VERSION } from "../../src/lib/enrich/prompt.ts";
import { cassetteKey, Cassettes } from "../../src/lib/enrich/cassette.ts";
import { publicRow, SCHEMA_HASH, DEFAULT_MODEL } from "../../src/lib/enrich/worker.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CASSETTE_DIR = HERE;
export const PERIOD_AS_OF = "2026-05-31";

/** A fee table as filings print one: label and figure never contiguous. */
const FEE_FILING = `
Northco Mining Corp.
Management Information Circular -- Auditor's Fees

The following table sets out the fees billed by the Company's auditor for the
financial years indicated. All amounts are expressed in thousands of Canadian
dollars.

                                        2025          2024
Audit fees                               412           388
Audit-related fees                        45            41
Tax fees                                 118           102
All other fees                             -             7
Total                                    575           538

The audit committee pre-approves all services provided by the auditor.
`;

const AIF = `
Northco Mining Corp.
Annual Information Form for the year ended 31 December 2025

Northco is a producing gold company. The Kirkland mine in northern Ontario
achieved commercial production on 1 July 2024 and produced 118,000 ounces in
2025. The Company also holds the Cerro Blanco development property in Peru,
where a feasibility study is under way, and a portfolio of exploration claims
in British Columbia.

The Company's auditor is Deloitte LLP, Chartered Professional Accountants,
appointed at the 2021 annual meeting.
`;

/** Seed the two fabricated companies the fixture uses. */
export function seedFixtureDatabase() {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  db.prepare("insert into periods (label, market_cap_as_of) values (?, ?)")
    .run(`Fixture (${PERIOD_AS_OF})`, PERIOD_AS_OF);
  const period = db.prepare("select id from periods limit 1").get();

  const companies = [
    { name: "Northco Mining Corp.", norm: "northco mining", ticker: "NRTH", exchange: "TSX",
      regions: { CANADA: ["ON"], "LATIN AMERICA": ["Peru"] } },
    { name: "Royalco Streaming Inc.", norm: "royalco streaming", ticker: "ROYL", exchange: "TSX",
      regions: {} },
  ];
  const ids = [];
  for (const c of companies) {
    db.prepare(
      `insert into companies (canonical_name, name_normalized, first_seen_period_id)
       values (?, ?, ?)`).run(c.name, c.norm, period.id);
    const row = db.prepare("select id from companies where name_normalized = ?").get(c.norm);
    ids.push({ ...c, id: row.id });
    db.prepare(
      `insert into company_identifiers (company_id, scheme, value, exchange, valid_from, source)
       values (?, 'root_ticker', ?, ?, ?, 'extract')`,
    ).run(row.id, c.ticker, c.exchange, PERIOD_AS_OF);
    db.prepare(
      `insert into company_aliases (company_id, name, name_normalized, alias_type, source)
       values (?, ?, ?, 'source_variant', 'workbook')`).run(row.id, c.name, c.norm);
    db.prepare(
      `insert into company_period_field_values
         (period_id, company_id, field_key, value, source, evidence_state)
       values (?, ?, 'property_regions', ?, 'extract', 'asserted')`,
    ).run(period.id, row.id, JSON.stringify(c.regions));
  }
  return { db, periodId: period.id, companies: ids };
}

const RESPONSES = {
  "Northco Mining Corp.": {
    documents: [
      { contentHash: "sha256:aif-northco", url: "https://northco.invalid/aif-2025.pdf",
        text: AIF, pageCount: 2, charsPerPage: AIF.length / 2,
        sourceTier: 1, docType: "annual_information_form", hasTextLayer: true },
      { contentHash: "sha256:circular-northco", url: "https://northco.invalid/circular-2026.pdf",
        text: FEE_FILING, pageCount: 2, charsPerPage: FEE_FILING.length / 2,
        sourceTier: 1, docType: "information_circular", hasTextLayer: true,
        scalePhrase: "in thousands" },
    ],
    findings: [
      { field_key: "stage_evidence_state",
        value: { exploration: true, development: true, production: true, royalty_streaming: false },
        evidence_excerpt: "The Kirkland mine in northern Ontario achieved commercial production on 1 July 2024",
        document_hash: "sha256:aif-northco", source_url: "https://northco.invalid/aif-2025.pdf",
        source_tier: 1, document_age_days: 120, corroborating_sources: 2,
        model_self_confidence: 0.91 },
      { field_key: "auditor", value: "Deloitte",
        evidence_excerpt: "The Company's auditor is Deloitte LLP, Chartered Professional Accountants",
        document_hash: "sha256:aif-northco", source_url: "https://northco.invalid/aif-2025.pdf",
        source_tier: 1, document_age_days: 120, corroborating_sources: 1,
        model_self_confidence: 0.88 },
      // Correctly grounded: 412 under an "in thousands" header is $412,000.
      { field_key: "audit_fee", value: 412000,
        numeric: { value: 412000, scale: "thousands", fiscalYear: 2025 },
        document_hash: "sha256:circular-northco",
        source_url: "https://northco.invalid/circular-2026.pdf",
        source_tier: 1, document_age_days: 90, corroborating_sources: 1,
        model_self_confidence: 0.84 },
      // PLANTED FABRICATION. This figure appears nowhere in the document. It is
      // deliberately plausible, well-formed and confidently stated -- exactly
      // the failure the gate exists to catch.
      { field_key: "tax_fee", value: 265000,
        numeric: { value: 265000, scale: "thousands", fiscalYear: 2025 },
        document_hash: "sha256:circular-northco",
        source_url: "https://northco.invalid/circular-2026.pdf",
        source_tier: 1, document_age_days: 90, corroborating_sources: 1,
        model_self_confidence: 0.93 },
    ],
    usage: { input_tokens: 8412, output_tokens: 611, cache_read_input_tokens: 7900 },
    cost_usd: 0.021,
  },
  "Royalco Streaming Inc.": {
    documents: [
      { contentHash: "sha256:royalco-ar", url: "https://royalco.invalid/annual-2025.pdf",
        text: `Royalco Streaming Inc. holds royalty and streaming interests over mines
operated by third parties. The Company holds no mineral properties directly and
conducts no exploration, development or mining operations of its own.`,
        pageCount: 1, charsPerPage: 220, sourceTier: 1, docType: "annual_report",
        hasTextLayer: true },
    ],
    findings: [
      { field_key: "stage_evidence_state",
        value: { exploration: false, development: false, production: false, royalty_streaming: true },
        evidence_excerpt: "Royalco Streaming Inc. holds royalty and streaming interests over mines operated by third parties",
        document_hash: "sha256:royalco-ar", source_url: "https://royalco.invalid/annual-2025.pdf",
        source_tier: 1, document_age_days: 200, corroborating_sources: 1,
        model_self_confidence: 0.95 },
      // Abstention is a first-class outcome, not a failure.
      { field_key: "audit_fee", value: null, abstained: true,
        abstention_reason: "the document does not disclose fees",
        document_hash: "sha256:royalco-ar", source_url: "https://royalco.invalid/annual-2025.pdf",
        source_tier: 1, document_age_days: 200, model_self_confidence: 0.12 },
    ],
    usage: { input_tokens: 3100, output_tokens: 240, cache_read_input_tokens: 2800 },
    cost_usd: 0.008,
  },
};

export function buildAll() {
  const { db, companies } = seedFixtureDatabase();
  const cassettes = new Cassettes(CASSETTE_DIR, "record");
  const written = [];
  for (const c of companies) {
    const row = publicRow(db, c.id, PERIOD_AS_OF);
    const prompt = buildPrompt("extract_general", row);
    const key = cassetteKey({
      route: "extract_general", model: DEFAULT_MODEL,
      promptVersion: PROMPT_VERSION, schemaHash: SCHEMA_HASH, content: prompt.userContent,
    });
    const body = RESPONSES[c.name];
    cassettes.write(key, {
      request: { route: "extract_general", model: DEFAULT_MODEL,
                 promptVersion: PROMPT_VERSION, userContent: prompt.userContent },
      response: body,
      usage: body.usage,
      verbatimTurn: null,
    });
    written.push({ company: c.name, key });
  }
  db.close();
  return written;
}

// Compare resolved paths: this repo's path contains a space, so the
// file:// URL is percent-encoded and a string compare never matches.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  for (const w of buildAll()) console.log(`${w.company.padEnd(24)} -> ${w.key}`);
}

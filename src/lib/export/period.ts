/**
 * The export, as the application serves it.
 *
 * Journey four in docs/design/01: the practice's deliverable is a clean
 * workbook, not the uploaded file. Until now it existed only as a command
 * (`npm run export`) against a SQLite file, which nobody in the pilot can run.
 *
 * WHAT IS EXPORTED. The working period -- the same rows the review screens and
 * the tier engine read, which is what `npm run export` writes. Not the frozen
 * publication: the snapshot does not carry the stage rows the matrix's four
 * stage columns need, and an Analyst exporting mid-review wants what they have
 * just decided. The cover sheet says which revision is published and whether
 * anything is newer, so a file can never quietly claim to be the published set.
 * A VIEWER MAY NOT EXPORT for exactly that reason -- the route requires an
 * Analyst -- and decision 11's boundary is unchanged.
 *
 * WHERE THE WORKBOOK IS BUILT. In Python, by the same `build_workbook` the
 * command line uses: on Vercel as the function in api/export.py, locally as a
 * `python3` subprocess. This module does the SQL and nothing else, in five
 * queries rather than five per company -- 259 companies over a pooled
 * connection is where a per-company query becomes a minute.
 */
import { spawn } from "node:child_process";
import type { Sql } from "../db/sql.ts";
import { pythonEndpoint, NotConfigured } from "../python/endpoint.ts";

export class ExportFailed extends Error {
  detail: string;
  constructor(message: string, detail = "") {
    super(message);
    this.name = "ExportFailed";
    this.detail = detail;
  }
}

export type ExportPayload = {
  period: Record<string, unknown>;
  companies: Array<{
    id: string; name: string;
    tier: number | null; status: string; footprint: string; rule_set_version: string | null;
    values: Record<string, unknown>;
    stages: string[];
    trace: { rule_id: string; inputs: string } | null;
    entity_id: string | null;
    prior_tier: number | null;
  }>;
  provenance: { source_file_sha256: string | null; rule_set_version: string | null; prior_period: string | null };
};

const parse = (raw: unknown): unknown => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return raw; }
};

/** One period, in the shape mmparser's build_workbook reads. */
export async function exportPayload(db: Sql, periodId?: string): Promise<ExportPayload> {
  const period = (periodId
    ? await db.get("select * from periods where id = ?", periodId)
    : await db.get("select * from periods order by market_cap_as_of desc limit 1")) as
      Record<string, unknown> | undefined;
  if (!period) throw new ExportFailed("There is no period to export.");

  const prior = await db.get(`select id, label from periods
      where status = 'published' and market_cap_as_of < ? order by market_cap_as_of desc limit 1`,
    String(period.market_cap_as_of)) as { id: string; label: string } | undefined;

  // A merged duplicate is not a company: exporting it would double-count a row
  // the merge screen exists to remove.
  const rows = await db.all(`select c.id, c.canonical_name, t.tier, t.status, t.footprint,
             t.rule_set_version
        from companies c
        left join tiers t on t.company_id = c.id and t.period_id = ?
       where c.status != 'merged'
       order by c.canonical_name`, period.id) as Array<Record<string, unknown>>;

  const values = await db.all(`select company_id, field_key, value
      from company_period_field_values where period_id = ?`, period.id) as
    Array<{ company_id: string; field_key: string; value: unknown }>;
  const stages = await db.all(`select company_id, stage from company_period_stages
      where period_id = ?`, period.id) as Array<{ company_id: string; stage: string }>;
  const traces = await db.all(`select company_id, rule_id, inputs, matched, ord
      from tier_traces where period_id = ? order by ord`, period.id) as
    Array<{ company_id: string; rule_id: string; inputs: unknown; matched: unknown; ord: number }>;
  const entities = await db.all(`select company_id, value from company_identifiers
      where scheme = 'sp_entity_id'`) as Array<{ company_id: string; value: string }>;
  const priorTiers = prior
    ? await db.all("select company_id, tier from tiers where period_id = ?", prior.id) as
        Array<{ company_id: string; tier: number | null }>
    : [];

  const valuesOf = new Map<string, Record<string, unknown>>();
  for (const v of values) {
    const bag = valuesOf.get(v.company_id) ?? {};
    bag[v.field_key] = parse(v.value);
    valuesOf.set(v.company_id, bag);
  }
  const stagesOf = new Map<string, string[]>();
  for (const s of stages) stagesOf.set(s.company_id, [...(stagesOf.get(s.company_id) ?? []), s.stage]);
  const traceOf = new Map<string, { rule_id: string; inputs: string }>();
  for (const t of traces) {
    // The first rule that fired, in order -- the one that decided the tier.
    if (!Boolean(t.matched) || traceOf.has(t.company_id)) continue;
    traceOf.set(t.company_id, {
      rule_id: t.rule_id,
      // As stored: the command line hands the comment the raw JSON text.
      inputs: typeof t.inputs === "string" ? t.inputs : JSON.stringify(t.inputs),
    });
  }
  const entityOf = new Map(entities.map((e) => [e.company_id, e.value]));
  const priorOf = new Map(priorTiers.map((t) => [t.company_id, t.tier === null ? null : Number(t.tier)]));

  return {
    period,
    companies: rows.map((r) => {
      const id = String(r.id);
      return {
        id,
        name: String(r.canonical_name),
        tier: r.tier === null || r.tier === undefined ? null : Number(r.tier),
        status: String(r.status ?? ""),
        footprint: String(r.footprint ?? ""),
        rule_set_version: (r.rule_set_version as string | null) ?? null,
        values: valuesOf.get(id) ?? {},
        stages: stagesOf.get(id) ?? [],
        trace: traceOf.get(id) ?? null,
        entity_id: entityOf.get(id) ?? null,
        prior_tier: priorOf.get(id) ?? null,
      };
    }),
    provenance: {
      source_file_sha256: (period.source_file_sha256 as string | null) ?? null,
      rule_set_version: (period.rule_set_version as string | null) ?? null,
      prior_period: prior?.label ?? null,
    },
  };
}

/** "Q3-2026 (2026-05-31)" -> "MM Whitespace Q3-2026.xlsx". */
export function exportFilename(label: string, extension: "xlsx" | "csv"): string {
  const name = String(label).replace(/\s*\([^)]*\)\s*$/, "").trim() || "period";
  return `MM Whitespace ${name.replace(/[^A-Za-z0-9 ._-]/g, "-")}.${extension}`;
}

/** The file itself: payload out, bytes back, from the Python that builds it. */
export async function exportWorkbook(
  db: Sql, opts: { periodId?: string; format?: "xlsx" | "csv" } = {},
): Promise<{ filename: string; contentType: string; bytes: Buffer }> {
  const format = opts.format ?? "xlsx";
  const payload = await exportPayload(db, opts.periodId);
  let endpoint;
  try {
    endpoint = pythonEndpoint("export");
  } catch (err) {
    throw new ExportFailed(err instanceof NotConfigured
      ? "The export builder is not configured on this deployment." : (err as Error).message);
  }
  const bytes = endpoint
    ? await buildRemotely(endpoint, payload, format)
    : await buildLocally(payload, format);
  return {
    filename: exportFilename(String(payload.period.label ?? "period"), format),
    contentType: format === "csv"
      ? "text/csv; charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes,
  };
}

async function buildRemotely(
  endpoint: { url: string; headers: Record<string, string> },
  payload: ExportPayload, format: "xlsx" | "csv",
): Promise<Buffer> {
  const secret = process.env.MM_PARSE_SECRET;
  if (!secret) throw new ExportFailed("The export builder is not configured on this deployment.");
  let res: Response;
  try {
    res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        ...endpoint.headers,
        "content-type": "application/json",
        "x-mm-parse-secret": secret,
        ...(format === "csv" ? { "x-mm-export-format": "csv" } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new ExportFailed("The export builder could not be reached. Try again in a minute.",
                           (err as Error).message);
  }
  if (res.status === 401) {
    // A configuration fault between two parts of this application, not
    // anything the Analyst did or can fix.
    throw new ExportFailed("The export builder refused this server. An Admin needs to check MM_PARSE_SECRET.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new ExportFailed(body.error ?? "That period could not be exported.");
  }
  return Buffer.from(await res.arrayBuffer());
}

/** The command-line path, for local work and the test suite. */
async function buildLocally(payload: ExportPayload, format: "xlsx" | "csv"): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn("python3", ["-m", "mmparser.export_service", ...(format === "csv" ? ["--csv"] : [])],
                        { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", (e) => reject(new ExportFailed("The export builder could not be run here.", e.message)));
    child.on("close", (code) => {
      if (code === 0 && out.length > 0) return resolve(Buffer.concat(out));
      const detail = Buffer.concat(err).toString("utf8").trim().split("\n").pop() ?? "";
      reject(new ExportFailed("That period could not be exported.", detail));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

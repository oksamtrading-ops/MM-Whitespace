import { test } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { tls } from "./postgres.ts";
import { SUPABASE_ROOT_2021_CA } from "./supabase_ca.ts";

const POOLER = "postgresql://postgres.x:y@aws-1-ca-central-1.pooler.supabase.com:5432/postgres";

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const was = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try { return fn(); } finally {
    if (was === undefined) delete process.env[key]; else process.env[key] = was;
  }
}

test("a Supabase host is verified against Supabase's root, never unverified", () => {
  withEnv("MM_DATABASE_CA", undefined, () => {
    const ssl = tls(POOLER) as { ca?: string; rejectUnauthorized: boolean };
    assert.equal(ssl.rejectUnauthorized, true);
    assert.equal(ssl.ca, SUPABASE_ROOT_2021_CA,
      "the system store does not trust Supabase's root, so without this the first contact fails");
  });
});

test("the direct host is a Supabase host too", () => {
  withEnv("MM_DATABASE_CA", undefined, () => {
    const ssl = tls("postgresql://postgres:y@db.abcdefgh.supabase.co:5432/postgres") as
      { ca?: string };
    assert.equal(ssl.ca, SUPABASE_ROOT_2021_CA);
  });
});

test("any other host uses the system store, still verified", () => {
  withEnv("MM_DATABASE_CA", undefined, () => {
    const ssl = tls("postgresql://u:p@db.example.com:5432/app") as
      { ca?: string; rejectUnauthorized: boolean };
    assert.equal(ssl.ca, undefined);
    assert.equal(ssl.rejectUnauthorized, true);
  });
});

test("MM_DATABASE_CA accepts the PEM text itself, for a platform with no filesystem", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
  withEnv("MM_DATABASE_CA", pem, () => {
    const ssl = tls(POOLER) as { ca?: string; rejectUnauthorized: boolean };
    assert.equal(ssl.ca, pem);
    assert.equal(ssl.rejectUnauthorized, true);
  });
});

test("sslmode=disable is honoured for a local socket, and nothing else turns it off", () => {
  assert.equal(tls("postgresql://u@localhost/app?sslmode=disable"), false);
  assert.notEqual(tls("postgresql://u@localhost/app?sslmode=require"), false);
});

test("the embedded root is exactly the one whose provenance is recorded", () => {
  // If this changes, it was edited -- by a rotation, or by somebody. Either way
  // it should be a deliberate act with its new provenance written down.
  const fingerprint = new X509Certificate(SUPABASE_ROOT_2021_CA).fingerprint256;
  assert.equal(fingerprint,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
  assert.match(new X509Certificate(SUPABASE_ROOT_2021_CA).subject, /Supabase Root 2021 CA/);
});

/* --------------------------------------------- transactions on a pool */

import { Pool } from "pg";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresSql } from "./postgres.ts";

/** A pool whose connections record what was sent to them. */
function recordingPool() {
  const log: Array<{ client: number; text: string }> = [];
  let next = 0;
  const pool = new Pool({ max: 4 });
  const clientFor = () => {
    const id = ++next;
    return {
      query: async (q: string | { text: string }) => {
        log.push({ client: id, text: typeof q === "string" ? q : q.text });
        return { rows: [], rowCount: 1 };
      },
      release: () => {},
    };
  };
  (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => clientFor();
  (pool as unknown as { query: (q: unknown) => Promise<unknown> }).query = async (q) => {
    log.push({ client: 0, text: typeof q === "string" ? q : (q as { text: string }).text });
    return { rows: [], rowCount: 1 };
  };
  return { pool, log };
}

test("a Postgres transaction is ONE connection: begin, every statement, commit", async () => {
  const { pool, log } = recordingPool();
  const db = new PostgresSql(pool);
  await db.tx(async (db) => {
    await db.run("insert into t values (?)", 1);
    await db.run("insert into t values (?)", 2);
  });
  const clients = new Set(log.map((l) => l.client));
  assert.equal(clients.size, 1, `statements spread over connections ${[...clients]}`);
  assert.ok(!clients.has(0), "nothing may go to the pool's shared query path");
  assert.deepEqual(log.map((l) => l.text.split(" ")[0]), ["begin", "insert", "insert", "commit"]);
});

test("a throw inside a Postgres transaction rolls back on the same connection", async () => {
  const { pool, log } = recordingPool();
  const db = new PostgresSql(pool);
  await assert.rejects(db.tx(async (db) => {
    await db.run("insert into t values (?)", 1);
    throw new Error("no");
  }));
  assert.equal(new Set(log.map((l) => l.client)).size, 1);
  assert.equal(log.at(-1)?.text, "rollback");
});

test("no application code opens a transaction by hand", () => {
  // `db.exec("begin")` works on SQLite and silently does not on a pool: that
  // shipped once, in publish, commit and merge. db.tx is the only way in.
  const root = join(import.meta.dirname, "..", "..");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry) || /\.test\.ts$/.test(entry)) continue;
      if (/[/\\]db[/\\](sqlite|postgres|sql)\.ts$/.test(full)) continue;
      const src = readFileSync(full, "utf8").replace(/\/\/.*$/gm, "");
      if (/\.exec\(\s*["'](begin|commit|rollback)["']/i.test(src)) offenders.push(full);
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], "use db.tx(async (db) => ...) instead");
});

/** Every unquoted camel-case column alias inside a template string, file by file. */
export function unquotedCamelAliases(root: string): string[] {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry) || /\.test\.ts$/.test(entry)) continue;
      // Template strings are the odd-numbered pieces between backticks: that is
      // where SQL lives, and where `as fooBar` is an alias rather than a cast.
      const pieces = readFileSync(full, "utf8").split("`");
      for (let i = 1; i < pieces.length; i += 2) {
        for (const m of pieces[i].matchAll(/\bas ([a-z]+[A-Z][A-Za-z0-9]*)\b/g)) {
          offenders.push(`${full.slice(root.length + 1)}: as ${m[1]}`);
        }
      }
    }
  };
  walk(root);
  return offenders;
}

test("no query names a column in camel case without quoting it", () => {
  // Postgres folds an unquoted identifier to lower case and SQLite does not,
  // so `select f.key as fieldKey` answers `fieldkey` in production and the
  // code reading `row.fieldKey` gets undefined -- which put /review/undefined
  // behind every link on the review board the first time production had a
  // finding, while every test (SQLite) passed. Quote it: as "fieldKey".
  const root = join(import.meta.dirname, "..", "..");
  assert.deepEqual(unquotedCamelAliases(root), [], 'write as "camelCase", with the quotes');
});

test("the alias check finds what it is meant to find", () => {
  // A check that never fails proves nothing.
  const dir = mkdtempSync(join(tmpdir(), "mm-alias-"));
  writeFileSync(join(dir, "q.ts"),
    'const a = db.all(`select f.key as fieldKey, f.label as "okLabel" from t`);\n' +
    "const b = x as unknown as SomeType;\n");
  assert.deepEqual(unquotedCamelAliases(dir), ["q.ts: as fieldKey"]);
});

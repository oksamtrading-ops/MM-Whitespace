/**
 * Record and replay.
 *
 * Replay is the default so the pipeline can be developed and tested with no
 * vendor key and no network. Live mode is the exception, and it is the only
 * mode that can send anything anywhere.
 *
 * A cassette is keyed by everything that would change the response: route,
 * model, prompt version, schema hash, and the per-company content. Change any
 * of them and the key misses, which is correct -- a stale recording answering a
 * changed prompt is worse than no recording.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Mode = "replay" | "record" | "live";

export type CassetteKey = {
  route: string;
  model: string;
  promptVersion: string;
  schemaHash: string;
  content: string;
};

export type Recording = {
  key: string;
  recordedAt: string;
  request: unknown;
  response: unknown;
  /**
   * Search results carry encrypted content that must be replayed byte-exact or
   * a continuation fails, so the assistant turn is persisted verbatim rather
   * than reconstructed.
   */
  verbatimTurn?: string;
  usage?: Record<string, number>;
};

export function cassetteKey(k: CassetteKey): string {
  const h = createHash("sha256");
  h.update([k.route, k.model, k.promptVersion, k.schemaHash, k.content].join("|"));
  return `${k.route}-${h.digest("hex").slice(0, 16)}`;
}

export class CassetteMiss extends Error {
  key: string;
  dir: string;
  constructor(key: string, dir: string) {
    super(
      `cassette miss: ${key}\n` +
      `  No recording in ${dir}. In replay mode nothing is sent to the vendor, so this\n` +
      `  is a hard stop. Re-record with a key and mode=record, or fix the inputs -- a\n` +
      `  changed prompt version or schema hash changes the key by design.`,
    );
    this.name = "CassetteMiss";
    this.key = key;
    this.dir = dir;
  }
}

export class Cassettes {
  dir: string;
  mode: Mode;
  constructor(dir: string, mode: Mode = "replay") {
    this.dir = dir;
    this.mode = mode;
    if (mode === "record" && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  path(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  has(key: string): boolean {
    return existsSync(this.path(key));
  }

  read(key: string): Recording {
    if (!this.has(key)) throw new CassetteMiss(key, this.dir);
    return JSON.parse(readFileSync(this.path(key), "utf8")) as Recording;
  }

  write(key: string, rec: Omit<Recording, "key" | "recordedAt">): Recording {
    const full: Recording = { key, recordedAt: new Date().toISOString(), ...rec };
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path(key), JSON.stringify(full, null, 2) + "\n");
    return full;
  }

  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  }
}

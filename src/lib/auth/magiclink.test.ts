import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import {
  consumeLink, hashToken, issueLink, MAX_LIVE_LINKS, purgeExpiredLinks, TooManyLinks,
} from "./magiclink.ts";
import { formatStamp } from "../db/stamp.ts";

function db(): Sql { return memorySql(); }

test("the database never holds a usable link", async () => {
  const d = db();
  const { token } = await issueLink(d, "analyst@example.invalid");
  const rows = await d.all("select token_hash from auth_magic_links");
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token, "the token itself must not be stored");
  assert.equal(rows[0].token_hash, hashToken(token));
  // And nothing anywhere in the row carries it.
  const whole = JSON.stringify(await d.all("select * from auth_magic_links"));
  assert.ok(!whole.includes(token), "the token appears in the row");
});

test("a link works once", async () => {
  const d = db();
  const { token } = await issueLink(d, "analyst@example.invalid");
  assert.deepEqual(await consumeLink(d, token), { ok: true, email: "analyst@example.invalid" });
  assert.deepEqual(await consumeLink(d, token), { ok: false, reason: "used" });
});

test("two clicks arriving together redeem once, not twice", async () => {
  const d = db();
  const { token } = await issueLink(d, "analyst@example.invalid");
  const [a, b] = await Promise.all([consumeLink(d, token), consumeLink(d, token)]);
  const wins = [a, b].filter((r) => r.ok).length;
  assert.equal(wins, 1, "exactly one of two simultaneous redemptions may succeed");
});

test("an expired link is refused", async () => {
  const d = db();
  const { token } = await issueLink(d, "analyst@example.invalid");
  await d.run("update auth_magic_links set expires_at = ?",
              formatStamp(Date.now() - 1000));
  assert.deepEqual(await consumeLink(d, token), { ok: false, reason: "expired" });
});

test("a token nobody issued is refused, and so is an empty one", async () => {
  const d = db();
  assert.deepEqual(await consumeLink(d, "not-a-token"), { ok: false, reason: "unknown" });
  assert.deepEqual(await consumeLink(d, ""), { ok: false, reason: "unknown" });
});

test("issuing does not depend on the roster, so the form cannot enumerate it", async () => {
  const d = db();
  // Nobody is in app_users at all.
  const stranger = await issueLink(d, "nobody@example.invalid");
  assert.ok(stranger.token, "a link is written for an address the roster has never seen");
  const redeemed = await consumeLink(d, stranger.token);
  assert.deepEqual(redeemed, { ok: true, email: "nobody@example.invalid" },
    "redemption returns the address; whether it is a USER is the caller's question");
});

test("live links per address are capped", async () => {
  const d = db();
  for (let i = 0; i < MAX_LIVE_LINKS; i++) await issueLink(d, "a@example.invalid");
  await assert.rejects(() => issueLink(d, "a@example.invalid"), TooManyLinks);
  // A different address is unaffected, and consuming one frees a slot.
  await issueLink(d, "b@example.invalid");
  const first = await d.get("select token_hash from auth_magic_links where lower(email) = 'a@example.invalid' limit 1") as { token_hash: string };
  await d.run("update auth_magic_links set consumed_at = ? where token_hash = ?",
              formatStamp(), first.token_hash);
  await issueLink(d, "a@example.invalid");
});

test("the cap counts live links only, not expired ones", async () => {
  const d = db();
  for (let i = 0; i < MAX_LIVE_LINKS; i++) await issueLink(d, "a@example.invalid");
  await d.run("update auth_magic_links set expires_at = ?", formatStamp(Date.now() - 1000));
  await issueLink(d, "a@example.invalid");
});

test("purge removes what has expired and keeps what has not", async () => {
  const d = db();
  await issueLink(d, "fresh@example.invalid");
  const { token } = await issueLink(d, "stale@example.invalid");
  await d.run("update auth_magic_links set expires_at = ? where token_hash = ?",
              formatStamp(Date.now() - 60 * 86_400_000), hashToken(token));
  assert.equal(await purgeExpiredLinks(d, 30), 1);
  const left = await d.all("select email from auth_magic_links");
  assert.deepEqual(left.map((r) => r.email), ["fresh@example.invalid"]);
});

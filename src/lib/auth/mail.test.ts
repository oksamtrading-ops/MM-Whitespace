import { test } from "node:test";
import assert from "node:assert/strict";
import { logSender, mailSender, MailNotConfigured, resendSender } from "./mail.ts";

const MAIL = { to: "a@example.invalid", subject: "s", text: "body" };

test("resend posts the message and nothing else", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  await resendSender("key_123", "Whitespace <no-reply@example.invalid>", fake).send(MAIL);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization,
               "Bearer key_123");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.to, ["a@example.invalid"]);
  assert.equal(body.from, "Whitespace <no-reply@example.invalid>");
  assert.equal(body.text, "body");
});

test("a refusal from resend is an error, and carries no key", async () => {
  const fake = (async () =>
    new Response("domain not verified", { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(
    () => resendSender("key_secret", "a@example.invalid", fake).send(MAIL),
    (err: Error) => {
      assert.match(err.message, /403/);
      assert.match(err.message, /domain not verified/);
      assert.ok(!err.message.includes("key_secret"), "the API key must not reach the message");
      return true;
    });
});

test("missing configuration is named, not guessed at", async () => {
  await assert.rejects(() => resendSender(undefined, "a@x.invalid").send(MAIL),
                       MailNotConfigured);
  await assert.rejects(() => resendSender("key", undefined).send(MAIL), MailNotConfigured);
  assert.throws(() => mailSender("carrier-pigeon"), MailNotConfigured);
});

test("the log sender refuses to run in production", async () => {
  const was = process.env.NODE_ENV;
  try {
    Object.defineProperty(process.env, "NODE_ENV",
      { value: "production", configurable: true, writable: true, enumerable: true });
    await assert.rejects(() => logSender().send(MAIL), MailNotConfigured);
  } finally {
    Object.defineProperty(process.env, "NODE_ENV",
      { value: was, configurable: true, writable: true, enumerable: true });
  }
});

test("MM_MAIL selects, and the default follows the key", () => {
  assert.equal(mailSender("log").name, "log");
  assert.equal(mailSender("resend").name, "resend");
  const was = process.env.MM_RESEND_KEY;
  try {
    delete process.env.MM_RESEND_KEY;
    assert.equal(mailSender(undefined).name, "log");
    process.env.MM_RESEND_KEY = "key";
    assert.equal(mailSender(undefined).name, "resend");
  } finally {
    if (was === undefined) delete process.env.MM_RESEND_KEY;
    else process.env.MM_RESEND_KEY = was;
  }
});

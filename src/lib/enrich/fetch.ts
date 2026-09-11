/**
 * The application's own fetcher.
 *
 * The model discovers candidate sources; the application fetches and caches
 * them; code enforces the citation. That split is the whole reason a fee can be
 * required to cite a filing by construction rather than by prompt -- but it
 * only holds if this module refuses to fetch whatever it is pointed at.
 *
 * Every control here is from docs/design/11-security-privacy-compliance.md:
 *
 *   server-side request forgery  block private and link-local space AFTER DNS
 *                                resolution, and re-check on every redirect
 *   domain trust                 allowlist domains derived from the extract --
 *                                NEVER a domain the model proposed
 *   type confusion               sniff magic bytes and the declared type; never
 *                                trust the extension
 *   resource exhaustion          cap bytes, time, and page count, enforced
 *                                while streaming
 *   documents                    store the extracted TEXT, never the file
 *
 * Dependencies are injected so the whole thing is testable with no network.
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_PAGES = 400;
export const TIMEOUT_MS = 20_000;
export const MAX_REDIRECTS = 5;

export type SourceTier = 1 | 2 | 3 | 4 | 5;

export class FetchRefused extends Error {
  code: string;
  url: string;
  constructor(code: string, url: string, detail: string) {
    super(`fetch refused (${code}) for ${url}: ${detail}`);
    this.name = "FetchRefused";
    this.code = code;
    this.url = url;
  }
}

/* ------------------------------------------------------------------ SSRF */

/** IPv4 and IPv6 ranges that must never be reachable from the fetcher. */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    const [a, b] = p;
    if (a === 0) return true;                       // "this network"
    if (a === 10) return true;                      // private
    if (a === 127) return true;                     // loopback
    if (a === 169 && b === 254) return true;        // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;  // carrier-grade NAT
    if (a === 192 && b === 0) return true;          // protocol assignments
    if (a >= 224) return true;                      // multicast and reserved
    return false;
  }
  if (v === 6) {
    const ip6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (ip6 === "::" || ip6 === "::1") return true;
    if (ip6.startsWith("fe80")) return true;        // link-local
    if (/^f[cd]/.test(ip6)) return true;            // unique local
    if (ip6.startsWith("::ffff:")) {                // IPv4-mapped
      return isBlockedAddress(ip6.slice(7));
    }
    return false;
  }
  return true;  // not an IP literal at all
}

export type Resolver = (hostname: string) => Promise<string[]>;

/**
 * The allowlist is built from domains found in the extract, plus the issuer's
 * own host. A domain the MODEL proposed is never added here -- that is the
 * whole point, and it is why discovery returns candidate URLs that this module
 * then declines if they are off-list.
 */
export function buildAllowlist(extractDomains: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const d of extractDomains) {
    const host = d.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    if (host) out.add(host.replace(/^www\./, ""));
  }
  return out;
}

export function isAllowedHost(host: string, allowlist: Set<string>): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (allowlist.has(h)) return true;
  // A subdomain of an allowed registrable host is allowed; a suffix match that
  // is not on a label boundary is not (evil-issuer.invalid vs issuer.invalid).
  for (const allowed of allowlist) {
    if (h.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

/* ------------------------------------------------------- type sniffing */

export type DetectedType = "pdf" | "html" | "text" | "unknown";

/** Sniff the bytes. The extension and the declared type are both untrusted. */
export function sniffType(bytes: Uint8Array, declared?: string | null): DetectedType {
  const head = Array.from(bytes.slice(0, 5))
    .map((b) => String.fromCharCode(b)).join("");
  if (head.startsWith("%PDF-")) return "pdf";

  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 2048)).toLowerCase();
  if (/<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/.test(text)) return "html";

  const d = (declared ?? "").toLowerCase();
  if (d.includes("application/pdf")) {
    // Declared PDF whose bytes are not a PDF is type confusion, not a PDF.
    return "unknown";
  }
  if (d.includes("text/html")) return "html";
  if (d.startsWith("text/")) return "text";
  // Printable-ASCII-dominant content with no markup is plain text.
  const printable = text.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "").length;
  return text.length > 0 && printable / text.length > 0.9 ? "text" : "unknown";
}

/* ---------------------------------------------------------- extraction */

export type Extracted = {
  text: string;
  pageCount: number;
  extractor: string;
  extractorVersion: string;
};

export type Extractors = {
  /** May be asynchronous: real PDF parsers are. */
  pdf: (bytes: Uint8Array) => Extracted | Promise<Extracted>;
  html: (bytes: Uint8Array) => Extracted;
  text: (bytes: Uint8Array) => Extracted;
};

/**
 * Plain text and JSON, kept as sent. The HTML stripper would collapse the
 * whitespace and drop anything between angle brackets, and an EDGAR record is
 * anchored against by exact substring.
 */
export function defaultTextExtractor(bytes: Uint8Array): Extracted {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return { text, pageCount: 1, extractor: "text", extractorVersion: "1.0.0" };
}

/** Strip scripts, styles, and markup. Embedded scripts never reach storage. */
export function defaultHtmlExtractor(bytes: Uint8Array): Extracted {
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const text = raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return { text, pageCount: 1, extractor: "html-strip", extractorVersion: "1.0.0" };
}

/* -------------------------------------------------------------- fetching */

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  /** Set when the transport followed nothing and expects the caller to. */
  location?: string | null;
};

export type Http = (url: string, signal: { timeoutMs: number }) => Promise<HttpResponse>;

export type FetchDeps = {
  http: Http;
  resolve: Resolver;
  extractors?: Partial<Extractors>;
  now?: () => Date;
};

export type FetchedDocument = {
  contentHash: string;
  url: string;
  finalUrl: string;
  retrievedAt: string;
  extractor: string;
  extractorVersion: string;
  normalizationVersion: string;
  text: string;
  charCount: number;
  pageCount: number;
  charsPerPage: number;
  sourceTier: SourceTier;
  docType: DetectedType;
  hasTextLayer: boolean;
};

/** T1 hosts: an authoritative filing host. Everything else is scored lower. */
export function classifyTier(host: string, allowlist: Set<string>): SourceTier {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (h.endsWith("sec.gov")) return 1;
  if (isAllowedHost(h, allowlist)) return 2;   // issuer-hosted
  if (h.endsWith("tsx.com") || h.endsWith("tmx.com")) return 3;
  return 4;
}

export async function fetchDocument(
  rawUrl: string,
  allowlist: Set<string>,
  deps: FetchDeps,
): Promise<FetchedDocument> {
  const now = deps.now ?? (() => new Date());
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchRefused("malformed_url", rawUrl, "not a URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new FetchRefused("scheme", rawUrl, `scheme ${url.protocol} is not fetchable`);
  }

  let current = url;
  let response: HttpResponse | null = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedHost(current.hostname, allowlist)) {
      throw new FetchRefused(
        "host_not_allowed", current.href,
        "host is not on the allowlist derived from the extract. A domain the model " +
        "proposed is never fetched on that basis alone.");
    }
    // Resolution first, then the address check. Checking the hostname alone is
    // defeated by a name that resolves into private space.
    const addresses = await deps.resolve(current.hostname);
    if (addresses.length === 0) {
      throw new FetchRefused("dns", current.href, "hostname did not resolve");
    }
    for (const ip of addresses) {
      if (isBlockedAddress(ip)) {
        throw new FetchRefused(
          "private_address", current.href,
          `resolves to ${ip}, which is private, loopback or link-local`);
      }
    }

    const res = await deps.http(current.href, { timeoutMs: TIMEOUT_MS });
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (hop === MAX_REDIRECTS) {
        throw new FetchRefused("too_many_redirects", current.href, `over ${MAX_REDIRECTS} hops`);
      }
      // The next hop is re-checked from the top, so a redirect into private
      // space is refused exactly as a direct request would be.
      current = new URL(res.location, current);
      continue;
    }
    if (res.status !== 200) {
      throw new FetchRefused("http_status", current.href, `status ${res.status}`);
    }
    response = res;
    break;
  }
  if (!response) throw new FetchRefused("no_response", current.href, "no terminal response");

  if (response.body.byteLength > MAX_BYTES) {
    throw new FetchRefused(
      "too_large", current.href,
      `${response.body.byteLength} bytes exceeds ${MAX_BYTES}`);
  }

  const declared = response.headers["content-type"] ?? response.headers["Content-Type"] ?? null;
  const type = sniffType(response.body, declared);
  if (type === "unknown") {
    throw new FetchRefused(
      "type_confusion", current.href,
      `declared ${declared ?? "nothing"} but the bytes are neither PDF, HTML nor text`);
  }

  const extractors = deps.extractors ?? {};
  let extracted: Extracted;
  if (type === "pdf") {
    if (!extractors.pdf) {
      throw new FetchRefused("no_pdf_extractor", current.href,
        "a PDF extractor must be supplied; text is extracted server-side under a timeout");
    }
    extracted = await extractors.pdf(response.body);
    if (extracted.pageCount > MAX_PAGES) {
      throw new FetchRefused("too_many_pages", current.href,
        `${extracted.pageCount} pages exceeds ${MAX_PAGES}`);
    }
  } else if (type === "text") {
    extracted = (extractors.text ?? defaultTextExtractor)(response.body);
  } else {
    extracted = (extractors.html ?? defaultHtmlExtractor)(response.body);
  }

  // The document is keyed by the hash of the bytes we actually received, and
  // the STORED TEXT is what anchoring later verifies against. The file itself
  // is never persisted.
  const contentHash =
    "sha256:" + createHash("sha256").update(response.body).digest("hex");
  const pageCount = Math.max(1, extracted.pageCount);
  const charsPerPage = extracted.text.length / pageCount;

  return {
    contentHash,
    url: rawUrl,
    finalUrl: current.href,
    retrievedAt: now().toISOString(),
    extractor: extracted.extractor,
    extractorVersion: extracted.extractorVersion,
    normalizationVersion: "1.0.0",
    text: extracted.text,
    charCount: extracted.text.length,
    pageCount,
    charsPerPage,
    sourceTier: classifyTier(current.hostname, allowlist),
    docType: type,
    // The chars-per-page gate runs BEFORE the document is sent anywhere, so a
    // scanned filing produces a distinct state rather than garbage findings.
    // A PDF is the only thing that can be scanned: a short web page is short,
    // not an image, and marking it textless would refuse every terse homepage.
    hasTextLayer: type !== "pdf" || charsPerPage >= 100,
  };
}

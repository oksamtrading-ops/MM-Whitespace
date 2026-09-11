/**
 * The real network, behind the fetcher's injected interfaces.
 *
 * fetch.ts decides WHAT may be fetched and is tested with no network. This is
 * HOW, and it adds the one control that cannot live there: the address check
 * at CONNECT time. fetch.ts resolves a host and refuses private space before
 * asking for it, but an ordinary HTTP client resolves the name again when it
 * connects, and a name that answers differently the second time -- DNS
 * rebinding -- would walk straight past the first check. The lookup handed to
 * the socket here refuses private space itself, so the address actually
 * connected to is the address that was checked.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { promises as dns } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { FetchRefused, isBlockedAddress, MAX_BYTES, type Http, type Resolver } from "./fetch.ts";

/** Who is asking. SEC EDGAR requires a contact in it and blocks requests without one. */
export function userAgentFor(host: string, contact: string | undefined = process.env.MM_SEC_CONTACT): string {
  const base = "MM-Whitespace-Research/1.0 (Deloitte Canada Mining & Metals pilot)";
  if (/(^|\.)sec\.gov$/i.test(host)) {
    if (!contact) {
      throw new FetchRefused("sec_contact_missing", `https://${host}`,
        "SEC EDGAR requires a contact email in the User-Agent. Set MM_SEC_CONTACT.");
    }
    return `${base} ${contact}`;
  }
  return base;
}

export const nodeResolve: Resolver = async (hostname) =>
  (await dns.lookup(hostname, { all: true })).map((a) => a.address);

/** A socket lookup that refuses private, loopback and link-local space. */
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad || list.length === 0) {
      return callback(new Error(`${hostname} resolved to ${bad?.address ?? "nothing"} at connect time; refused`), "");
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function decoded(res: IncomingMessage): Readable {
  switch ((res.headers["content-encoding"] ?? "").toLowerCase()) {
    case "gzip": case "x-gzip": return res.pipe(createGunzip());
    case "deflate": return res.pipe(createInflate());
    case "br": return res.pipe(createBrotliDecompress());
    default: return res;
  }
}

/**
 * One request, no redirects followed -- fetch.ts follows them itself, so each
 * hop is checked from the top. The body is capped while it streams, after
 * decompression, so a small compressed response cannot expand past the cap.
 */
export const nodeHttp: Http = (url, { timeoutMs }) => new Promise((resolve, reject) => {
  const u = new URL(url);
  let userAgent: string;
  try { userAgent = userAgentFor(u.hostname); } catch (err) { reject(err); return; }

  const request = u.protocol === "https:" ? httpsRequest : httpRequest;
  const req = request(u, {
    method: "GET",
    lookup: guardedLookup as never,
    headers: {
      "user-agent": userAgent,
      accept: "text/html,application/pdf,application/json,text/plain;q=0.9,*/*;q=0.5",
      "accept-encoding": "gzip, deflate, br",
    },
  }, (res) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
    const status = res.statusCode ?? 0;

    if (status >= 300 && status < 400) {
      res.resume();
      resolve({ status, headers, body: new Uint8Array(), location: headers.location ?? null });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const stream = decoded(res);
    stream.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BYTES) {
        req.destroy();
        reject(new FetchRefused("too_large", url, `over ${MAX_BYTES} bytes while streaming`));
        return;
      }
      chunks.push(c);
    });
    stream.on("end", () => resolve({ status, headers, body: new Uint8Array(Buffer.concat(chunks)), location: null }));
    stream.on("error", reject);
  });
  req.setTimeout(timeoutMs, () => req.destroy(new FetchRefused("timeout", url, `no response in ${timeoutMs} ms`)));
  req.on("error", reject);
  req.end();
});

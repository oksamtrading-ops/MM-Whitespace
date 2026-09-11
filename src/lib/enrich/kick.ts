/**
 * Ask a worker to start, over HTTP, without waiting for it to finish.
 *
 * The tick and the worker are separate functions (docs/design/03), so the
 * tick asks for one by request. The worker answers 202 as soon as it has
 * scheduled itself and drains after the response, so this returns in well
 * under a second and holds nothing open.
 *
 * The base URL is MM_PUBLIC_URL when set -- a deployment knows its own
 * address and a Host header is attacker-controlled -- and otherwise the
 * origin of the request that is asking, which is what local development and
 * the end-to-end suite need.
 */
export const WORKER_PATH = "/api/worker/drain";

export type KickOptions = {
  /** Origin of the request that is asking, used only when MM_PUBLIC_URL is unset. */
  origin?: string | null;
  probe?: boolean;
  secret?: string | undefined;
  publicUrl?: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function workerUrl(
  origin: string | null | undefined, publicUrl: string | undefined = process.env.MM_PUBLIC_URL,
): string | null {
  const base = (publicUrl ?? origin ?? "").replace(/\/+$/, "");
  return base ? `${base}${WORKER_PATH}` : null;
}

export async function kickWorker(opts: KickOptions = {}): Promise<{ ok: boolean; note: string }> {
  const secret = opts.secret ?? process.env.MM_CRON_SECRET;
  if (!secret) return { ok: false, note: "MM_CRON_SECRET is not set; no worker was asked" };

  const url = workerUrl(opts.origin, opts.publicUrl ?? process.env.MM_PUBLIC_URL);
  if (!url) return { ok: false, note: "no MM_PUBLIC_URL and no request origin; no worker was asked" };

  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${url}${opts.probe ? "?probe=1" : ""}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    const body = await res.json().catch(() => ({})) as { note?: string };
    if (res.status === 202) return { ok: true, note: "a worker was asked to start" };
    return { ok: false, note: `the worker answered ${res.status}${body.note ? `: ${body.note}` : ""}` };
  } catch (err) {
    return { ok: false, note: `the worker could not be reached: ${(err as Error).message}` };
  }
}

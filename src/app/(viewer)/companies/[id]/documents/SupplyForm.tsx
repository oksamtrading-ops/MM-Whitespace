"use client";

import { useRef, useState, useTransition } from "react";
import Callout from "../../../../_ui/Callout.tsx";
import {
  addDocumentPiece, beginDocumentUpload, finishDocumentUpload, supplyDocument, type SupplyResult,
} from "./actions.ts";

type Props = {
  companyId: string;
  periodId: string;
  /** The company's website, as the application trusts it this quarter. */
  site: string;
  kinds: ReadonlyArray<{ kind: string; label: string }>;
  attestation: string;
  /** Larger than this, the file is sent in pieces: Vercel refuses a request over 4.5 MB. */
  chunkBytes: number;
  maxBytes: number;
};

const mb = (n: number) => (n / 1048576).toFixed(1);

/**
 * Supply a PDF downloaded from the company's website. A file that fits one
 * request goes whole; a larger one in pieces, one after another, and then the
 * server reads it. Either way only its text is kept.
 */
export default function SupplyForm({ companyId, periodId, site, kinds, attestation, chunkBytes, maxBytes }: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<SupplyResult | null>(null);
  const [pending, start] = useTransition();

  function send(form: HTMLFormElement) {
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) { setResult({ ok: false, message: "Choose the PDF first." }); return; }
    if (file.size > maxBytes) {
      setResult({ ok: false, message: `That file is ${mb(file.size)} MB. The limit is ${mb(maxBytes)} MB.` });
      return;
    }
    setResult(null);
    start(async () => {
      let out: SupplyResult;
      try {
        if (file.size <= chunkBytes) {
          setProgress("Reading the file…");
          out = await supplyDocument(data);
        } else {
          const meta = new FormData();
          for (const k of ["companyId", "periodId", "url", "kind", "attested"]) meta.set(k, String(data.get(k) ?? ""));
          meta.set("filename", file.name);
          meta.set("sizeBytes", String(file.size));
          const begun = await beginDocumentUpload(meta);
          if (!begun.ok) { out = begun; return; }
          out = { ok: false, message: "The file was not sent." };
          for (let i = 0; i < begun.chunkCount; i++) {
            setProgress(`Sending piece ${i + 1} of ${begun.chunkCount}…`);
            const piece = new FormData();
            piece.set("uploadId", begun.uploadId);
            piece.set("idx", String(i));
            piece.set("piece", file.slice(i * begun.chunkBytes, (i + 1) * begun.chunkBytes));
            const sent = await addDocumentPiece(piece);
            if (!sent.ok) { out = sent; return; }
          }
          setProgress("Reading the file…");
          const finish = new FormData();
          finish.set("uploadId", begun.uploadId);
          finish.set("companyId", companyId);
          out = await finishDocumentUpload(finish);
        }
      } catch {
        out = { ok: false, message: "The connection failed while sending the file. Nothing was kept. Try again." };
      } finally {
        setProgress(null);
      }
      setResult(out);
      if (out.ok) { formRef.current?.reset(); setChosen(null); }
    });
  }

  return (
    <form ref={formRef} className="commit"
          onSubmit={(e) => { e.preventDefault(); send(e.currentTarget); }}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="periodId" value={periodId} />

      <label className="drop">
        <span className="lab">The PDF</span>
        <input type="file" name="file" accept="application/pdf,.pdf" required
               onChange={(e) => setChosen(e.target.files?.[0] ?? null)} />
        <span className="hint">
          {chosen
            ? <>{chosen.name} · <span className="fig-sm">{mb(chosen.size)}</span> MB</>
            : `A PDF with text in it, up to ${mb(maxBytes)} MB, as you downloaded it. A scan cannot be quoted from.`}
        </span>
      </label>

      <p className="field">
        <label htmlFor="url">The address you downloaded it from</label>
        <input id="url" name="url" type="url" required autoComplete="off" inputMode="url"
               placeholder={`https://${site}/…`} />
        <span className="hint">
          From the browser&rsquo;s address bar, on {site} or a subdomain of it. It is the link review
          shows beside every value read from the file.
        </span>
      </p>

      <p className="field">
        <label htmlFor="kind">What it is</label>
        <select id="kind" name="kind" required defaultValue="">
          <option value="" disabled>Choose…</option>
          {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
        <span className="hint">Research reads documents in this order: a current annual filing before an interim one.</span>
      </p>

      <p className="check">
        <input type="checkbox" id="attested" name="attested" value="yes" required />
        <label htmlFor="attested">{attestation}</label>
      </p>

      <div role="status" aria-live="polite">
        {progress && <p className="meta">{progress}</p>}
        {result && (result.ok
          ? <Callout tone="ok" title="Supplied">{result.message}</Callout>
          : <Callout tone="danger" title="Not supplied">{result.message}</Callout>)}
      </div>

      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? "Sending…" : "Supply this document"}
      </button>
    </form>
  );
}

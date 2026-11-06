"use client";

import { useState, useTransition } from "react";
import { removeDocument } from "./actions.ts";

/** Remove a supplied document, after asking. What it found and nobody decided leaves review. */
export default function RemoveButton({ suppliedId, name }: { suppliedId: string; name: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="btn sm secondary" disabled={pending}
              aria-label={`Remove ${name}`}
              onClick={() => {
                if (!window.confirm(`Remove ${name}? Research stops reading it, and what it found that nobody has decided leaves review.`)) return;
                const data = new FormData();
                data.set("suppliedId", suppliedId);
                start(async () => { setMessage((await removeDocument(data)).message ?? null); });
              }}>
        {pending ? "Removing…" : "Remove"}
      </button>
      {message && <span className="meta" role="status"> {message}</span>}
    </>
  );
}

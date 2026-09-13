"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The bulk-accept confirmation. It is the ONLY path to a bulk accept and it has
 * no suppress-this-dialog option. Stage determines tier and tier is the
 * deliverable, so for a stage field the opt-in is typed, not clicked.
 */
export default function BulkDialog({ open, text, needsStage, onConfirm, onCancel }: {
  open: boolean; text: string | null; needsStage: boolean;
  onConfirm: (stageOptIn: string) => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setTyped(""); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);

  const count = text?.match(/^Accept (\d+)/)?.[1];
  const nothing = count === "0";
  const armed = !nothing && (!needsStage || typed.trim().toUpperCase() === "STAGE");

  return (
    <dialog ref={ref} aria-labelledby="bulk-h" onClose={onCancel}
            onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="bulk-h">Accept in bulk</h2>
      <p>{text ?? "Counting what qualifies…"}</p>
      {nothing && <p><b>Nothing here qualifies.</b> Every value in this view needs an individual decision.</p>}
      {needsStage && (
        <>
          <p><b>Stage determines the tier.</b> Type <code>STAGE</code> to confirm.</p>
          <input type="text" name="stage" aria-label="Type STAGE to confirm" value={typed}
                 onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </>
      )}
      <div className="acts">
        <button type="button" className="btn quiet" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary" disabled={!text || !armed}
                onClick={() => onConfirm(typed)}>
          {count ? `Accept ${count} value${count === "1" ? "" : "s"}` : "Accept"}
        </button>
      </div>
    </dialog>
  );
}

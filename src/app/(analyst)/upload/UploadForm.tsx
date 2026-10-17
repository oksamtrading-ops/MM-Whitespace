"use client";

import { useActionState, useRef, useState } from "react";
import { uploadWorkbook } from "./actions.ts";
import Callout from "../../_ui/Callout.tsx";

/** Choose a workbook or TSX's list, or drop one on the same target. */
export default function UploadForm() {
  const [state, action, pending] = useActionState(uploadWorkbook, null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [chosen, setChosen] = useState<{ name: string; size: number } | null>(null);
  const [over, setOver] = useState(false);

  function take(files: FileList | null) {
    const file = files?.[0];
    setChosen(file ? { name: file.name, size: file.size } : null);
  }

  return (
    <form action={action}>
      <label className={`drop${over ? " over" : ""}`}
             onDragOver={(e) => { e.preventDefault(); setOver(true); }}
             onDragLeave={() => setOver(false)}
             onDrop={(e) => {
               e.preventDefault(); setOver(false);
               if (inputRef.current && e.dataTransfer.files.length) {
                 inputRef.current.files = e.dataTransfer.files;
                 take(e.dataTransfer.files);
               }
             }}>
        <span className="lab">Workbook or TSX list</span>
        <input ref={inputRef} type="file" name="workbook" accept=".xlsx"
               onChange={(e) => take(e.target.files)} />
        <span className="hint">
          {chosen
            ? <>{chosen.name} · <span className="fig-sm">{(chosen.size / 1048576).toFixed(2)}</span> MB</>
            : "An .xlsx file, up to 4 MB: the practice’s workbook, or TSX’s list of mining companies. Drop one here or choose a file."}
        </span>
      </label>

      <div role="status" aria-live="polite">
        {state && !state.ok && (
          <Callout tone="danger" title="Not read">{state.message}{state.detail ? ` ${state.detail}` : ""}</Callout>
        )}
      </div>

      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? "Reading the file…" : "Read this file"}
      </button>
      <p className="meta" style={{ marginTop: 12 }}>
        Reading it writes nothing. You will see the validation report first, and commit from there.
      </p>
    </form>
  );
}

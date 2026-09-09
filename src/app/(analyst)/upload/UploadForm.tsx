"use client";

import { useActionState, useRef, useState } from "react";
import { uploadWorkbook } from "./actions.ts";

/** Choose a workbook, or drop one on the same target. */
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
        <span className="lab">Workbook</span>
        <input ref={inputRef} type="file" name="workbook" accept=".xlsx"
               onChange={(e) => take(e.target.files)} />
        <span className="hint">
          {chosen
            ? <>{chosen.name} · <span className="fig-sm">{(chosen.size / 1048576).toFixed(2)}</span> MB</>
            : "An .xlsx workbook, up to 25 MB. Drop one here or choose a file."}
        </span>
      </label>

      <div role="status" aria-live="polite">
        {state && !state.ok && (
          <div className="notice alert">
            <b>Not read</b>
            <span>{state.message}{state.detail ? ` ${state.detail}` : ""}</span>
          </div>
        )}
      </div>

      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? "Reading the workbook…" : "Read this workbook"}
      </button>
      <p className="meta" style={{ marginTop: 12 }}>
        Reading it writes nothing. You will see the validation report first, and commit from there.
      </p>
    </form>
  );
}

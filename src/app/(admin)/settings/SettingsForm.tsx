"use client";

import { useActionState } from "react";
import { saveSettings } from "./actions.ts";
import type { Setting } from "../../../lib/settings/index.ts";

export default function SettingsForm({ settings }: { settings: Setting[] }) {
  const [state, action, pending] = useActionState(saveSettings, null);

  return (
    <form action={action} className="commit settings">
      {settings.map((s) => (
        <p className="field" key={s.key}>
          <label htmlFor={s.key}>{s.label}</label>
          {s.kind === "operator" ? (
            <select id={s.key} name={s.key} defaultValue={s.value}>
              <option value="gte">At or above the threshold</option>
              <option value="gt">Above the threshold</option>
            </select>
          ) : (
            <span className="withunit">
              {s.kind === "usd" && <span className="unit" aria-hidden="true">$</span>}
              <input id={s.key} name={s.key} defaultValue={s.value} required
                     inputMode={s.kind === "currency" ? "text" : "decimal"}
                     autoComplete="off" spellCheck={false}
                     maxLength={s.kind === "currency" ? 3 : undefined} />
              {s.kind === "percent" && <span className="unit" aria-hidden="true">%</span>}
            </span>
          )}
          <span className="hint">{s.help}</span>
          {s.updatedBy && (
            <span className="hint">Last changed by {s.updatedBy}.</span>
          )}
        </p>
      ))}

      <div role="status" aria-live="polite">
        {state && (
          <div className={`notice ${state.ok ? "ok" : "alert"}`}>
            <b>{state.ok ? "Saved" : "Not saved"}</b>
            <span>{state.message}</span>
          </div>
        )}
      </div>

      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? "Saving…" : "Save defaults"}
      </button>
      <p className="meta" style={{ marginTop: 12 }}>
        These apply to the next period committed. A period already published keeps the
        values it was published against.
      </p>
    </form>
  );
}

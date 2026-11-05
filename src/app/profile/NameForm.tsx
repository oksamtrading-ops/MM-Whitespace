"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveOwnName, type NameResult } from "./actions.ts";
import Callout from "../_ui/Callout.tsx";
import { NAME_MAX } from "../../lib/auth/person.ts";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn primary" disabled={pending}>
      {pending ? "Saving…" : label}
    </button>
  );
}

/**
 * Your first and last name. The same form at the name gate, where it is the
 * only thing on the screen, and on your profile, where it edits them.
 */
export default function NameForm({ first, last, required = false }: {
  first: string | null; last: string | null; required?: boolean;
}) {
  const [state, action] = useActionState<NameResult | null, FormData>(saveOwnName, null);

  return (
    <form action={action} className="credentials">
      {required && (
        <Callout tone="warn" title="Add your name to continue">
          The tool shows your name, not your address, wherever it says who did
          something: who started a research run, who published a revision.
        </Callout>
      )}

      <label htmlFor="first-name">First name</label>
      <input id="first-name" name="first" type="text" required maxLength={NAME_MAX}
             defaultValue={first ?? ""} autoComplete="given-name" />

      <label htmlFor="last-name">Last name</label>
      <input id="last-name" name="last" type="text" required maxLength={NAME_MAX}
             defaultValue={last ?? ""} autoComplete="family-name" />

      <Submit label={required ? "Continue" : "Save"} />
      <div role="status" aria-live="polite">
        {state?.ok === false && <Callout tone="danger" title="Not saved">{state.message}</Callout>}
        {state?.ok === true && !required && <Callout tone="ok" title="Saved">Your name is updated.</Callout>}
      </div>
    </form>
  );
}

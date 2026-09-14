"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changePasswordAction, type ChangeResult } from "./actions.ts";
import Callout from "../_ui/Callout.tsx";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn primary" disabled={pending}>
      {pending ? "Saving…" : "Set this password"}
    </button>
  );
}

export default function PasswordForm({ forced = false }: { forced?: boolean }) {
  const [state, action] = useActionState<ChangeResult | null, FormData>(
    changePasswordAction, null);

  return (
    <form action={action} className="credentials">
      {forced && (
        <Callout tone="warn" title="Choose your own password">
          The one you signed in with was set for you by an administrator, so
          nobody but you knows the next one.
        </Callout>
      )}

      {/* The current password is required even when the change is forced. It is
          not ceremony: this action is reachable with a sameSite=lax cookie, and
          somebody who cannot supply the current password cannot drive it. */}
      <label htmlFor="current">Current password</label>
      <input id="current" name="current" type="password" required
             autoComplete="current-password" />

      <label htmlFor="next">New password</label>
      <input id="next" name="next" type="password" required minLength={12}
             autoComplete="new-password" aria-describedby="password-help" />
      <p id="password-help" className="help">
        At least twelve characters. Length is the only rule — a long ordinary
        sentence beats a short complicated one.
      </p>

      <label htmlFor="confirm">New password again</label>
      <input id="confirm" name="confirm" type="password" required
             autoComplete="new-password" />

      <Submit />
      <div role="status" aria-live="polite">
        {/* The only thing this action ever RETURNS is a refusal: success
            redirects, so there is no success state to render here. */}
        {state && (
          <Callout tone="danger" title="That password was not set">{state.message}</Callout>
        )}
      </div>
    </form>
  );
}

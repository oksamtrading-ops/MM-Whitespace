"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestSignInLink, type SignInResult } from "./actions.ts";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn primary" disabled={pending}>
      {pending ? "Sending…" : "Email me a sign-in link"}
    </button>
  );
}

export default function SignInForm({ invalid = false }: { invalid?: boolean }) {
  const [state, action] = useActionState<SignInResult | null, FormData>(
    requestSignInLink, null);

  return (
    <form action={action} className="magiclink">
      {invalid && !state && (
        <p className="notice alert" role="status">
          That sign-in link cannot be used. Links last fifteen minutes and work once —
          ask for another below.
        </p>
      )}
      <label htmlFor="email">Work email</label>
      <input id="email" name="email" type="email" autoComplete="email" required
             spellCheck={false} placeholder="you@deloitte.ca"
             aria-describedby="signin-help" />
      <p id="signin-help" className="help">
        Invite only. No password — a link arrives in your inbox.
      </p>
      <Submit />
      {/* One live region for the one answer this form ever gives. */}
      <div role="status" aria-live="polite">
        {state && <p className="notice" style={{ marginTop: 16 }}>{state.message}</p>}
      </div>
    </form>
  );
}

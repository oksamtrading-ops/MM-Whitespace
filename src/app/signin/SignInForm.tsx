"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signIn, type SignInResult } from "./actions.ts";
import Callout from "../_ui/Callout.tsx";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn primary" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export default function SignInForm() {
  const [state, action] = useActionState<SignInResult | null, FormData>(signIn, null);

  return (
    <form action={action} className="credentials">
      <label htmlFor="email">Work email</label>
      <input id="email" name="email" type="email" autoComplete="username" required
             spellCheck={false} placeholder="you@deloitte.ca" />

      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" required
             autoComplete="current-password" aria-describedby="signin-help" />
      <p id="signin-help" className="help">
        Invite only. An administrator sets your first password.
      </p>

      <Submit />

      {/* One live region, and one sentence in it. Success never lands here --
          it redirects -- so anything shown is a refusal, and every refusal
          reads the same whoever asks. */}
      <div role="status" aria-live="polite">
        {state && <Callout tone="danger" title="Not signed in">{state.message}</Callout>}
      </div>
    </form>
  );
}

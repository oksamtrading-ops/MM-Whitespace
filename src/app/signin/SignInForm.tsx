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
      {/* The absence of a "forgot password" link is a decision, and a screen
          that does not say so reads as one that forgot. There is no reset by
          email because there is no email in this flow at all -- which is the
          point of it, and is what let the practice onboard somebody the mail
          provider could not reach. So the answer is here, where a person looks
          for the link, rather than only in the refusal they would have to fail
          first to see. */}
      <p id="signin-help" className="help">
        Invite only — an administrator sets your first password.<br />
        <strong>Forgotten it?</strong> There is no reset by email. An
        administrator can issue you a new one, and you choose your own when you
        sign in with it.
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

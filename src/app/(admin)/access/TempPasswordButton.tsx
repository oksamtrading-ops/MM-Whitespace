"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { issueTemporaryPassword, type TempPasswordResult } from "./actions.ts";
import Icon from "../../_ui/Icon.tsx";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn sm secondary${pending ? " loading" : ""}`}
            disabled={pending} aria-busy={pending || undefined}>
      <Icon name="lock" size={13} />New password
    </button>
  );
}

/**
 * Issue a temporary password and show it ONCE.
 *
 * It is rendered here, in the row, and deliberately NOT inside a table of its
 * own: tests/e2e/journeys.mjs reads this screen by slicing from the accounts
 * table to the FIRST closing tag, so a nested table would make four access
 * review assertions start matching the wrong rows without failing.
 *
 * The value lives in this one response. Reloading the page loses it, which is
 * the intended behaviour -- if it is gone, issue another.
 */
export default function TempPasswordButton({ userId }: { userId: string }) {
  const [state, action] = useActionState<TempPasswordResult | null, FormData>(
    issueTemporaryPassword, null);

  return (
    <form action={action} className="temp-password">
      <input type="hidden" name="userId" value={userId} />
      <Submit />
      <div role="status" aria-live="polite">
        {state?.ok === true && (
          <div className="issued">
            <code>{state.password}</code>
            <p>
              Shown once. Give it to {state.email} over something other than this
              screen — they will be asked to replace it when they sign in.
              {state.sessionsRevoked > 0 &&
                ` ${state.sessionsRevoked} session${state.sessionsRevoked === 1 ? "" : "s"} ended.`}
            </p>
          </div>
        )}
        {state?.ok === false && <p className="issued-refused">{state.message}</p>}
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { inviteUser, type InviteResult } from "./actions.ts";
import Callout from "../../_ui/Callout.tsx";
import Icon from "../../_ui/Icon.tsx";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn primary${pending ? " loading" : ""}`}
            disabled={pending} aria-busy={pending || undefined}>
      <Icon name="users" size={14} />Invite
    </button>
  );
}

/**
 * Invite somebody, and show the password once.
 *
 * One form for both halves. An account with a row and no password looks
 * invited and cannot sign in, which is a state worth making unreachable rather
 * than documenting.
 */
export default function InviteForm() {
  const [state, action] = useActionState<InviteResult | null, FormData>(inviteUser, null);

  return (
    <div className="invite">
      <form action={action}>
        <div className="fields">
          <span>
            <label htmlFor="invite-email">Work email</label>
            <input id="invite-email" name="email" type="email" required
                   spellCheck={false} placeholder="someone@deloitte.ca" autoComplete="off" />
          </span>
          <span>
            <label htmlFor="invite-role">Role</label>
            <select id="invite-role" name="role" defaultValue="viewer">
              <option value="viewer">Viewer — reads the published period</option>
              <option value="analyst">Analyst — reviews, runs and publishes</option>
              <option value="admin">Admin — all of that, plus access and settings</option>
            </select>
          </span>
          <Submit />
        </div>
      </form>

      <div role="status" aria-live="polite">
        {state?.ok === true && (
          <Callout tone="ok" title={`${state.email} can sign in as ${state.role}`}>
            <code className="issued-code">{state.password}</code>
            Shown once. Give it to them over something other than this screen — they
            will be asked to replace it the first time they sign in.
          </Callout>
        )}
        {state?.ok === false && (
          <Callout tone="danger" title="Not invited">{state.message}</Callout>
        )}
      </div>
    </div>
  );
}

"use client";

import { useFormStatus } from "react-dom";
import { setRole } from "./actions.ts";

function Select({ role, disabled }: { role: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <select name="role" defaultValue={role} disabled={disabled || pending}
            aria-label="Role" aria-busy={pending || undefined}
            // Submitting on change rather than behind a Save button: there is
            // one field and three values, so a button would only add a way to
            // change a role and not save it.
            onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      <option value="viewer">Viewer</option>
      <option value="analyst">Analyst</option>
      <option value="admin">Admin</option>
    </select>
  );
}

/**
 * Change what somebody may do, from the row that says who they are.
 *
 * Disabled for yourself. An Admin demoting themselves is one click from an
 * application with no Admin in it, and the cure is behind an Admin session --
 * the same reason self-deactivation is refused. The action refuses it too,
 * because a disabled control is not a boundary.
 */
export default function RoleSelect(
  { userId, role, self }: { userId: string; role: string; self: boolean },
) {
  return (
    <form action={setRole} className="rolepick">
      <input type="hidden" name="userId" value={userId} />
      <Select role={role} disabled={self} />
    </form>
  );
}

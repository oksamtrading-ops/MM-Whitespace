import type { Metadata } from "next";
import { requireRole } from "../../lib/auth/context.ts";
import { Forbidden, type Unauthenticated } from "../../lib/auth/session.ts";
import PasswordForm from "./PasswordForm.tsx";
import Refusal from "../_ui/Refusal.tsx";
import Orb from "../_ui/Orb.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your password" };

/**
 * Change your own password.
 *
 * The one screen that passes allowPasswordChange, along with its action. Every
 * other page and action refuses somebody holding a temporary password, and this
 * is where they are sent -- so it must not refuse them itself.
 *
 * It is still a real role assertion: all three roles are named, so somebody
 * with no active row on the roster is refused here exactly as anywhere else.
 * Only the password gate is waived, and only by name.
 */
export default async function PasswordPage() {
  const { user } = await requireRole(
    ["admin", "analyst", "viewer"], { allowPasswordChange: true })
    .catch((err: unknown) => ({ user: err as Error }));

  if (user instanceof Error) {
    return user instanceof Forbidden
      ? <Refusal title="Not permitted" body={user.message} />
      : <Refusal title="Sign in" body={(user as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  return (
    <div className="page"><div className="signin rise">
      <div className="lockup">
        <h1 translate="no">Whitespace<span className="stop" aria-hidden="true" /></h1>
        <p className="firm">Deloitte</p>
      </div>
      <Orb />
      <p className="who">{user.email}</p>
      <PasswordForm forced={user.mustChangePassword} />
    </div></div>
  );
}

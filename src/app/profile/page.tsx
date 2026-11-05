import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "../../lib/auth/context.ts";
import { Forbidden, type Unauthenticated } from "../../lib/auth/session.ts";
import NameForm from "./NameForm.tsx";
import Refusal from "../_ui/Refusal.tsx";
import Orb from "../_ui/Orb.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your profile" };

/**
 * Your own name, and the way to your password.
 *
 * Waives the name gate, as its action does: it is where a name is given. The
 * root layout shows the same form in place of any page while the name is
 * missing, so this page is for changing a name, not for the first one.
 */
export default async function ProfilePage() {
  const { user } = await requireRole(["admin", "analyst", "viewer"], { allowMissingName: true })
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
        <h1 translate="no">Market Assessment Tool<span className="stop" aria-hidden="true" /></h1>
        <p className="firm">Deloitte</p>
      </div>
      <Orb />
      <p className="who">{user.name}</p>
      <NameForm first={user.firstName} last={user.lastName} />
      <p className="help"><Link href="/password">Change your password</Link></p>
    </div></div>
  );
}

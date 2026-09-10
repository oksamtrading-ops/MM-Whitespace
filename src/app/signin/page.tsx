import Link from "next/link";
import type { Metadata } from "next";
import { authContext } from "../../lib/auth/context.ts";
import { resolveUser } from "../../lib/auth/session.ts";
import Refusal from "../_ui/Refusal.tsx";
import SignInButtons from "./SignInButtons.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

/**
 * Development sign-in.
 *
 * NOT magic-link authentication. It exists so the application can be opened in
 * a browser before a Supabase project does, and the claim source it writes for
 * refuses to run outside development. In production this page renders nothing
 * but a note saying so.
 */
export default async function SignIn() {
  if (process.env.NODE_ENV === "production") {
    return (
      <Refusal title="Sign in"
               body="This build has no identity provider configured yet. Magic-link sign-in, and then Deloitte SSO, plug in at the claim source." />
    );
  }

  // Offering a sign-in to somebody who is already signed in is a small lie the
  // top bar immediately contradicts, so say who they are and let them past.
  const ctx = await authContext();
  const user = await resolveUser(ctx.db, await ctx.claims.emailClaim(ctx.cookieHeader));

  return (
    <div className="signin rise">
      <h1 translate="no">Whitespace<span className="stop" aria-hidden="true" /></h1>
      {user ? (
        <>
          <p className="lede">
            Signed in as {(await user).email}, {(await user).role === "admin" ? "an" : "a"} {(await user).role}.
          </p>
          <p className="actions">
            <Link className="btn primary" href="/" prefetch={false}>
              Continue{(await user).role === "viewer" ? " to the dashboard" : " to the review board"}
            </Link>
          </p>
          <p className="switch">Switch account</p>
        </>
      ) : (
        <p className="lede">
          Which Canadian miners Deloitte does not audit yet, and the evidence for saying so.
        </p>
      )}
      <SignInButtons currentEmail={user?.email ?? null} />
      <p className="foot">
        Development sign-in. These three accounts exist in <code>app_users</code>; nothing else
        is accepted, and this page refuses to run outside development.
      </p>
    </div>
  );
}

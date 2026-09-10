import Link from "next/link";
import type { Metadata } from "next";
import { authContext } from "../../lib/auth/context.ts";
import { resolveUser } from "../../lib/auth/session.ts";
import SignInButtons from "./SignInButtons.tsx";
import SignInForm from "./SignInForm.tsx";
import { signOut } from "./actions.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

/**
 * Sign in.
 *
 * Magic link, no passwords -- doc 11, which removes credential stuffing,
 * password reuse and reset flows in one decision. The three development
 * accounts still render when MM_AUTH=dev, so the application can be driven
 * without an inbox; that path refuses to run in production on its own account.
 */
export default async function SignIn(
  { searchParams }: { searchParams: Promise<{ link?: string }> },
) {
  const dev = process.env.MM_AUTH === "dev";
  const { link } = await searchParams;

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
            Signed in as {user.email}, {user.role === "admin" ? "an" : "a"} {user.role}.
          </p>
          <p className="actions">
            <Link className="btn primary" href="/" prefetch={false}>
              Continue{user.role === "viewer" ? " to the dashboard" : " to the review board"}
            </Link>
          </p>
          <form action={signOut}>
            <button type="submit" className="switch">Sign out</button>
          </form>
        </>
      ) : (
        <>
          <p className="lede">
            Which Canadian miners Deloitte does not audit yet, and the evidence for saying so.
          </p>
          <SignInForm invalid={link === "invalid"} />
        </>
      )}
      {dev && <SignInButtons currentEmail={user?.email ?? null} />}
      {dev && (
        <p className="foot">
          Development sign-in is on (<code>MM_AUTH=dev</code>). These three accounts exist in{" "}
          <code>app_users</code>; nothing else is accepted, and the claim source behind them
          refuses to run outside development.
        </p>
      )}
    </div>
  );
}

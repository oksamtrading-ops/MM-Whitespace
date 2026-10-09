import Link from "next/link";
import { authContext } from "../lib/auth/context.ts";
import { resolveUser } from "../lib/auth/session.ts";
import { HOME_LABEL, homeFor } from "../lib/auth/home.ts";
import AiNotice from "./_ui/AiNotice.tsx";
import Orb from "./_ui/Orb.tsx";

export const dynamic = "force-dynamic";

/**
 * The landing page: what this is, how its information was produced, and the
 * way in.
 *
 * This used to be a redirect that sent each role to its board. It renders now
 * because the AI notice has to be read somewhere everybody passes, and every
 * sign-in, password change and development sign-in already ends at "/" -- so
 * this page is where they all arrive. There is no acknowledgement gate: the
 * notice is stated, not clicked through.
 *
 * Where "Continue" goes is homeFor(), which the sign-in screen asks too. As
 * before, a destination is a convenience and never a boundary.
 */
export default async function Home() {
  const ctx = await authContext();
  const user = await resolveUser(ctx.db, await ctx.claims.emailClaim(ctx.cookieHeader));
  const home = homeFor(user);

  return (
    <div className="page"><div className="signin front rise">
      <div className="lockup">
        <h1 translate="no">Market Assessment Tool<span className="stop" aria-hidden="true" /></h1>
        <span className="firm" translate="no">Deloitte · Mining &amp; Metals</span>
      </div>
      <Orb className="orb" />
      <p className="lede">
        Every TSX and TSXV mining company above the market-cap threshold: the stage it
        operates at, where it works, who audits it, and the evidence behind each value.
      </p>
      <AiNotice />
      <p className="actions">
        <Link className="btn primary" href={home} prefetch={false}>{HOME_LABEL[home]}</Link>
      </p>
      {user && (
        <p className="who">
          Signed in as {user.email}, {user.role === "admin" ? "an" : "a"} {user.role}.
        </p>
      )}
    </div></div>
  );
}

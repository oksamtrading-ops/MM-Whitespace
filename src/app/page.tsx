import Link from "next/link";
import { authContext } from "../lib/auth/context.ts";
import { resolveUser } from "../lib/auth/session.ts";
import { HOME_LABEL, homeFor } from "../lib/auth/home.ts";
import { formatInteger } from "../lib/format/fields.ts";
import { aboutTheTool, monthYear, thresholdWords } from "../lib/publish/landing.ts";
import Orb from "./_ui/Orb.tsx";

export const dynamic = "force-dynamic";

/**
 * The tiers in the practice's own words, as its cover page states them. They
 * say the same as the dashboard's TIER_RULE in a reader's terms: "only" where
 * the rules exclude the tiers above, and Tier 5 taking in the exploration a
 * developer may also do.
 */
const TIERS: ReadonlyArray<readonly [number, string]> = [
  [1, "Production in Canada and abroad"],
  [2, "Production in Canada only"],
  [3, "Production abroad only"],
  [4, "Royalty and streaming only"],
  [5, "Development and exploration"],
  [6, "Exploration only"],
];

/**
 * The landing page: the practice's cover page for the tool -- what it is for,
 * how its information was produced, the approach behind it -- and the way in.
 *
 * Every sign-in, password change and development sign-in ends at "/", so this
 * is where everybody reads how the information was produced. There is no
 * acknowledgement gate: the statement is made, not clicked through.
 *
 * Its figures are the newest published period's (lib/publish/landing.ts),
 * never a draft's, and only for somebody signed in: the tool is invite-only,
 * and a visitor is told what it is, not what is in it. Until something has
 * been published there are no figures, and the approach says nothing it
 * would have to make up.
 *
 * Where "Continue" goes is homeFor(), which the sign-in screen asks too. As
 * before, a destination is a convenience and never a boundary.
 */
export default async function Home() {
  const ctx = await authContext();
  const user = await resolveUser(ctx.db, await ctx.claims.emailClaim(ctx.cookieHeader));
  const home = homeFor(user);
  const about = user && !user.mustChangePassword ? await aboutTheTool(ctx.db) : null;

  return (
    <div className="page"><div className="signin front rise">
      <div className="lockup">
        <h1 translate="no">Mining &amp; Metals Marketplace Assessment Tool<span className="stop" aria-hidden="true" /></h1>
        <span className="firm" translate="no">Deloitte</span>
      </div>
      <Orb className="orb" />
      {about && <p className="updated">Last updated on {monthYear(about.lastUpdated)}.</p>}
      <p className="lede">
        This tool is intended to assist with the preliminary identification of potential targets and
        market opportunities. Information was researched and compiled with the assistance of artificial
        intelligence. Users should perform an appropriate review of the tool&rsquo;s outputs and consult the
        supporting sources to confirm that the information is sufficiently accurate, complete, and current
        for its intended use.
      </p>
      {about && (
        <section className="approach" aria-labelledby="approach">
          <h2 id="approach">Approach and methodology</h2>
          {about.listedIssuers !== null
            ? <p>
                As of {monthYear(about.asOf)}, there are {formatInteger(about.listedIssuers)} companies listed in
                the TSX and TSX-V indicated as Mining and Metals issuers. The database included in the tool
                considers only companies with a market cap {thresholdWords(about.threshold)}.
              </p>
            : <p>
                As of {monthYear(about.asOf)}, the database included in the tool considers only companies listed
                in the TSX and TSX-V as Mining and Metals issuers with a market cap {thresholdWords(about.threshold)}.
              </p>}
          <p>
            The tool analyzed {formatInteger(about.companies)} {about.companies === 1 ? "company" : "companies"} categorized
            in the following tiers:
          </p>
          <ul className="tierlist">
            {TIERS.map(([tier, words]) => (
              <li key={tier}><span className="n">Tier {tier}</span> <span aria-hidden="true">–</span> {words}</li>
            ))}
          </ul>
          <p>
            Information was primarily retrieved from TSX reports, companies&rsquo; websites and latest Annual
            Information Forms filed.
          </p>
        </section>
      )}
      <p className="actions">
        <Link className="btn primary" href={home} prefetch={false}>{HOME_LABEL[home]}</Link>
      </p>
      {user && (
        <p className="who">
          Signed in as {user.name}, {user.role === "admin" ? "an" : "a"} {user.role}.
        </p>
      )}
    </div></div>
  );
}

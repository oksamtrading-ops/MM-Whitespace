import "./globals.css";
import type { Metadata } from "next";
import { Archivo, Open_Sans } from "next/font/google";
import { authContext } from "../lib/auth/context.ts";
import { resolveUser } from "../lib/auth/session.ts";
import Nav, { type NavItem } from "./_ui/Nav.tsx";
import { periodName } from "./_ui/format.ts";

/* Open Sans is the brand face and carries everything you read. Archivo carries
   every figure that measures something -- its width axis lets the hero and
   ledger figures sit condensed while table numerals stay at full width. Both
   are fetched at build time and self-hosted; nothing is loaded at runtime. */
const text = Open_Sans({
  subsets: ["latin"], variable: "--font-open-sans", display: "swap",
  fallback: ["Arial", "Helvetica", "sans-serif"],
});
const figure = Archivo({
  subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap",
  fallback: ["Arial Narrow", "Arial", "sans-serif"],
});

export const viewport = { themeColor: "#FFFFFF" };

export const metadata: Metadata = {
  title: { default: "Whitespace", template: "%s · Whitespace" },
  description: "Mining & Metals whitespace analysis",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await authContext();
  const email = await ctx.claims.emailClaim(ctx.cookieHeader);
  const user = resolveUser(ctx.db, email);
  const canReview = user?.role === "analyst" || user?.role === "admin";

  const items: NavItem[] = [];
  if (canReview) items.push({ href: "/review", label: "Review" });
  items.push({ href: "/dashboard", label: "Dashboard" });
  if (user?.role === "admin") items.push({ href: "/access", label: "Access" });

  // The period chip. A Viewer is shown a period only once it is published;
  // draft state is the workstation's business.
  const period = user
    ? ctx.db.prepare(
        `select p.label, p.status,
                (select max(revision) from period_publications where period_id = p.id) as revision
           from periods p order by p.market_cap_as_of desc limit 1`,
      ).get() as { label: string; status: string; revision: number | null } | undefined
    : undefined;
  const showPeriod = period && (period.revision !== null || canReview);

  return (
    <html lang="en-CA" className={`${text.variable} ${figure.variable}`}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="topbar">
          <a className="brand" href="/" translate="no">Whitespace<span className="stop" aria-hidden="true" /></a>
          <Nav items={items} />
          <div className="right">
            {showPeriod && (
              <span className="chip">
                <span className={`dot${period.revision === null ? " draft" : ""}`} aria-hidden="true" />
                <span className="fig-sm">{periodName(period.label).name}</span>
                <span className="rev">{period.revision === null ? "draft" : `rev ${period.revision}`}</span>
              </span>
            )}
            <div className="who">
              {user
                ? <><span className="email">{user.email}</span><span className="role">{user.role}</span></>
                : <a href="/signin">Sign in</a>}
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1}>{children}</main>
      </body>
    </html>
  );
}

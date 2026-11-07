import "./globals.css";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Archivo, Open_Sans } from "next/font/google";
import { authContext } from "../lib/auth/context.ts";
import { resolveUser } from "../lib/auth/session.ts";
import Sidebar, { type NavItem } from "./_ui/Sidebar.tsx";
import { RAIL_COOKIE, showsWorking, THEME_COOKIE, WORKING_COOKIE, type Theme } from "./_ui/theme.ts";
import { periodName } from "./_ui/format.ts";
import NameForm from "./profile/NameForm.tsx";

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

/* The theme is a cookie so the first paint is already in it. Absent a choice
   the product is dark: that is the brand decision (docs/design/18), and the
   light theme is one press away in the rail's foot. */
async function readTheme(): Promise<Theme> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return v === "light" || v === "system" ? v : "dark";
}

export async function generateViewport(): Promise<Viewport> {
  const theme = await readTheme();
  if (theme === "system") {
    return { themeColor: [
      { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
      { media: "(prefers-color-scheme: dark)", color: "#000000" },
    ] };
  }
  return { themeColor: theme === "light" ? "#FFFFFF" : "#000000" };
}

export const metadata: Metadata = {
  title: { default: "Mining & Metals Marketplace Assessment Tool", template: "%s · Mining & Metals Marketplace Assessment Tool" },
  description: "Deloitte Mining & Metals market assessment",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await authContext();
  const email = await ctx.claims.emailClaim(ctx.cookieHeader);
  const user = await resolveUser(ctx.db, email);
  // Every destination in the rail refuses somebody who has not replaced their
  // temporary password, so offering them is offering a row of dead ends. The
  // rail keeps the user, because signing out must stay reachable from anywhere.
  const gated = user?.mustChangePassword === true;
  // The name gate, after the password one. Every page and action already
  // refuses this account (assertRole); here the form that lets them past
  // takes the page's place, so they meet it wherever they land.
  const needsName = !gated && user?.needsName === true;
  const held = gated || needsName;
  const canReview = !held && (user?.role === "analyst" || user?.role === "admin");
  const jar = await cookies();
  const theme = await readTheme();
  const railCollapsed = jar.get(RAIL_COOKIE)?.value === "1";
  const working = showsWorking(jar.get(WORKING_COOKIE)?.value, canReview);

  /* Three groups, because the destinations are three things: the product a
     partner reads, the period an analyst builds, and the administration
     behind both. A Viewer sees the first group only. */
  const items: NavItem[] = [];
  if (!held) {
    items.push({ href: "/dashboard", label: "Dashboard", icon: "layout-dashboard", group: "product" });
    items.push({ href: "/companies", label: "Companies", icon: "building-2", group: "product" });
    items.push({ href: "/reports", label: "Reports", icon: "file-spreadsheet", group: "product" });
  }
  if (canReview) items.push({ href: "/upload", label: "Upload", icon: "upload", group: "period" });
  if (canReview) items.push({ href: "/runs", label: "Runs", icon: "play", group: "period" });
  if (canReview) items.push({ href: "/review", label: "Review", icon: "clipboard-check", group: "period" });
  if (canReview) items.push({ href: "/publish", label: "Publish", icon: "badge-check", group: "period" });
  if (!held && user?.role === "admin") items.push({ href: "/access", label: "Access", icon: "users", group: "admin" });
  if (!held && user?.role === "admin") items.push({ href: "/settings", label: "Settings", icon: "settings", group: "admin" });
  if (!held && user?.role === "admin") items.push({ href: "/styleguide", label: "Styleguide", icon: "palette", group: "admin" });

  // The period, in the rail's foot. A Viewer is shown the newest PUBLISHED one,
  // the one every page they can open is reading; draft state is the
  // workstation's business.
  const period = user
    ? await ctx.db.get(
        `select p.label, p.status,
                (select max(revision) from period_publications where period_id = p.id) as revision
           from periods p
          where ? = 1 or exists (select 1 from period_publications pp where pp.period_id = p.id)
          order by p.market_cap_as_of desc limit 1`, canReview ? 1 : 0,
      ) as { label: string; status: string; revision: number | null } | undefined
    : undefined;
  const showPeriod = period && (period.revision !== null || canReview);

  return (
    <html lang="en-CA" data-theme={theme} className={`${text.variable} ${figure.variable}`}>
      <body className={working ? undefined : "working-off"}>
        <a className="skip" href="#main">Skip to content</a>
        <div className="app">
          <Sidebar items={items} collapsed={railCollapsed} theme={theme}
                   period={showPeriod ? { name: periodName(period.label).name, draft: period.revision === null } : null}
                   user={user ? { name: user.name, role: user.role } : null} />
          <main id="main" tabIndex={-1}>
            {needsName && user
              ? <div className="page"><div className="signin rise">
                  <div className="lockup">
                    <h1 translate="no">Mining & Metals Marketplace Assessment Tool<span className="stop" aria-hidden="true" /></h1>
                    <p className="firm">Deloitte</p>
                  </div>
                  <NameForm first={user.firstName} last={user.lastName} required />
                </div></div>
              : children}
          </main>
        </div>
      </body>
    </html>
  );
}

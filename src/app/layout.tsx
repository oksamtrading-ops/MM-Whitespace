import "./globals.css";
import type { Metadata } from "next";
import { authContext } from "../lib/auth/context.ts";
import { resolveUser } from "../lib/auth/session.ts";

export const metadata: Metadata = {
  title: "Mining Whitespace",
  description: "Mining & Metals whitespace analysis",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await authContext();
  const email = await ctx.claims.emailClaim(ctx.cookieHeader);
  const user = resolveUser(ctx.db, email);

  return (
    <html lang="en-CA">
      <body>
        <div className="shell">
          <nav className="rail" aria-label="Sections">
            <div className="brand">Mining <span>Whitespace</span></div>
            {user && (user.role === "analyst" || user.role === "admin") && (
              <a href="/review">Review</a>
            )}
            <a href="/dashboard">Dashboard</a>
            <div className="who">
              {user ? `${user.email}\n${user.role}` : "not signed in"}
            </div>
          </nav>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}

import { redirect } from "next/navigation";
import { authContext } from "../lib/auth/context.ts";
import { resolveUser } from "../lib/auth/session.ts";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ctx = await authContext();
  const user = resolveUser(ctx.db, await ctx.claims.emailClaim(ctx.cookieHeader));
  // A redirect is a convenience, never a boundary. Each page asserts its own role.
  redirect(user && user.role !== "viewer" ? "/review" : "/dashboard");
}

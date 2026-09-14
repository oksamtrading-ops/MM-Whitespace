import { redirect } from "next/navigation";
import { authContext } from "../lib/auth/context.ts";
import { resolveUser } from "../lib/auth/session.ts";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ctx = await authContext();
  const user = await resolveUser(ctx.db, await ctx.claims.emailClaim(ctx.cookieHeader));
  // Somebody still holding a temporary password can go to exactly one place.
  // Without this they are sent to a board that refuses them, and the refusal
  // offers /signin, which offers the password screen -- a correct destination
  // reached by two dead ends.
  if (user?.mustChangePassword) redirect("/password");
  // A redirect is a convenience, never a boundary. Each page asserts its own role.
  redirect(user &&user.role !== "viewer" ? "/review" : "/dashboard");
}

import type { AppUser } from "./session.ts";

/**
 * Where "Continue" goes from the landing page, for whoever is reading it.
 *
 * The landing page replaced a redirect that made this choice silently, and
 * the sign-in screen's own "Continue" made it a second time in its wording --
 * two places to keep in step. Both ask here now.
 *
 * A destination is a convenience, never a boundary: each page asserts its own
 * role. Somebody still holding a temporary password can go to exactly one
 * place, and sending them anywhere else reaches a refusal that offers sign-in,
 * which offers the password screen -- the right place by two dead ends.
 *
 * Type-only import, so a client component can use this without reaching the
 * session module's node built-ins.
 */
export type Home = "/password" | "/dashboard" | "/review" | "/signin";

export function homeFor(user: Pick<AppUser, "role" | "mustChangePassword"> | null): Home {
  if (!user) return "/signin";
  if (user.mustChangePassword) return "/password";
  return user.role === "viewer" ? "/dashboard" : "/review";
}

/** The words for that destination, so a button never promises somewhere else. */
export const HOME_LABEL: Record<Home, string> = {
  "/password": "Set a new password to continue",
  "/dashboard": "Continue to the dashboard",
  "/review": "Continue to the review board",
  "/signin": "Sign in",
};

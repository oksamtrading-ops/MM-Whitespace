/* Shared by the server layout and the client switch. A plain module: a
   constant exported from a "use client" file reaches a Server Component as a
   client reference, not a string, and the cookie was silently never read. */
export type Theme = "dark" | "light" | "system";
export const THEME_COOKIE = "mm_theme";

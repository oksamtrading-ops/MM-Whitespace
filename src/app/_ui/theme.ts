/* Shared by the server layout and the client rail. A plain module: a constant
   exported from a "use client" file reaches a Server Component as a client
   reference, not a string, and the cookie was silently never read. */
export type Theme = "dark" | "light" | "system";
export const THEME_COOKIE = "mm_theme";
/** The rail's collapsed state. A cookie, so the server renders it at the width
    the reader chose and it does not jump on first paint. */
export const RAIL_COOKIE = "mm_rail";

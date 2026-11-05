/**
 * How the tool names a person: their display name, else their address.
 *
 * The address is still the account. It is what a person signs in with and
 * what an Admin invites, and nothing here changes that. This is only what the
 * screens print wherever they say who somebody is or who did something.
 *
 * No imports, so session.ts, sessions.ts and signin.ts can all use it without
 * a cycle between them.
 */
export function personName(u: { email: string; display_name?: string | null }): string {
  const name = u.display_name?.trim();
  return name ? name : u.email;
}

/**
 * The same rule in SQL, for a query that names whoever did something:
 * `${personSql("u")} as by_name`. Null when the join found nobody.
 */
export function personSql(alias: string): string {
  return `coalesce(nullif(trim(${alias}.display_name), ''), ${alias}.email)`;
}

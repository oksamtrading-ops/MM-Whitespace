/**
 * How the tool names a person: their first and last name.
 *
 * Every account must have both (migration 0039, and assertRole's name gate),
 * so the address is only a fallback for an account invited before names were
 * required and not yet signed in since. The address is still the account: it
 * is what a person signs in with and what an Admin invites, and nothing here
 * changes that. This is only what the screens print wherever they say who
 * somebody is -- who started a run, who published a revision.
 *
 * No imports, so session.ts, sessions.ts and signin.ts can all use it without
 * a cycle between them.
 */
export type PersonRow = { email: string; first_name?: string | null; last_name?: string | null };

/** Both names present. Anything less and the name gate stops the account. */
export function hasFullName(u: PersonRow): boolean {
  return Boolean(u.first_name?.trim()) && Boolean(u.last_name?.trim());
}

export function personName(u: PersonRow): string {
  const name = [u.first_name?.trim(), u.last_name?.trim()].filter(Boolean).join(" ");
  return name || u.email;
}

/**
 * The same rule in SQL, for a query that names whoever did something:
 * `${personSql("u")} as by_name`. Null when the join found nobody. Written with
 * `||` and trim rather than concat_ws so both engines read it.
 */
export function personSql(alias: string): string {
  return `coalesce(nullif(trim(coalesce(${alias}.first_name, '') || ' ' || coalesce(${alias}.last_name, '')), ''), ${alias}.email)`;
}

export const NAME_MAX = 80;

export type NameCheck =
  | { ok: true; first: string; last: string }
  | { ok: false; message: string };

/**
 * A first and last name as typed, or the sentence saying what is wrong.
 * Shared by the invitation and the form a person fills in for themselves, so
 * the two cannot disagree about what a name is.
 */
export function checkName(firstRaw: unknown, lastRaw: unknown): NameCheck {
  const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const first = clean(firstRaw);
  const last = clean(lastRaw);
  if (!first || !last) return { ok: false, message: "Enter both a first and a last name." };
  if (first.length > NAME_MAX || last.length > NAME_MAX) {
    return { ok: false, message: `A name is at most ${NAME_MAX} characters.` };
  }
  // A control character has no place in a name, and an @ means an address was
  // typed where the name goes -- the thing this field exists to stop showing.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f@<>]/.test(first + last)) {
    return { ok: false, message: "A name cannot contain @, < or >, or control characters." };
  }
  return { ok: true, first, last };
}

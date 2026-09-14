/**
 * Give somebody a temporary password, from outside the application.
 *
 *   node scripts/set_temp_password.mjs ./period.db someone@example.invalid
 *   node scripts/set_temp_password.mjs "$MM_DATABASE_URL" kay@deloitte.ca
 *
 * THIS IS THE BREAK-GLASS, not only the bootstrap.
 *
 * Two situations need it and neither can be solved from inside the product:
 *
 *   1. The first password. /access is where an Admin sets one, and /access is
 *      behind an Admin session -- so before anybody has a password at all,
 *      there is no way in. This is what breaks that circle, and it is why the
 *      cutover runs it while the OLD sign-in still works.
 *
 *   2. A locked door. The sign-in throttle refuses eight wrong guesses in a
 *      quarter of an hour, and anybody who knows a colleague's address can
 *      spend those guesses on their behalf. There is deliberately no unlock
 *      button on /access -- both Admins locked out at once, with the cure
 *      behind an Admin session, is the same circle again. So the unlock lives
 *      here, outside, and this clears the counter as well as setting the word.
 *
 * It never becomes an HTTP endpoint, for the reason both of those share: what
 * makes it safe is that reaching it means already having the database URL.
 *
 * The password is printed to stdout and written nowhere else -- not the audit
 * log, which records only that it happened and who for.
 */
import { openTarget } from "./retention.mjs";
import { setTemporaryPassword } from "../src/lib/auth/signin.ts";
import { formatStamp } from "../src/lib/db/stamp.ts";

const [target, email] = process.argv.slice(2);

if (!target || !email) {
  console.error("usage: node scripts/set_temp_password.mjs <db-path-or-url> <email>");
  process.exit(2);
}

const db = openTarget(target);
try {
  const user = await db.get(
    "select id, email, is_active from app_users where lower(email) = lower(?)", email);

  if (!user) {
    // Invite first. Creating the row here would put account creation in two
    // places, and the 0024 trigger's domain allowlist is enforced on the
    // insert -- which is where that decision belongs.
    console.error(`no account for ${email}.`);
    console.error("invite them first:  insert into app_users (email, role) values (…, 'analyst');");
    process.exit(1);
  }
  if (!user.is_active) {
    // A credential for an account that refuses it is a way to believe access
    // was restored when it was not.
    console.error(`${user.email} is deactivated. Reactivate on /access first.`);
    process.exit(1);
  }

  const { password, sessionsRevoked } = await setTemporaryPassword(
    db, { targetId: user.id, actorId: null });

  // actor_id is null: nobody did this through the application. That is the
  // same convention a script's run already follows elsewhere.
  await db.run("insert into audit_log (event, actor_id, detail) values (?, ?, ?)",
               "password_set_by_admin", null,
               JSON.stringify({ targetId: user.id, targetEmail: user.email,
                                by: "scripts/set_temp_password.mjs",
                                sessionsRevoked, at: formatStamp() }));

  console.log(`\n  ${user.email}\n  ${password}\n`);
  console.log(`  Shown once. ${sessionsRevoked} session(s) ended; any sign-in throttle cleared.`);
  console.log("  They will be asked to replace it when they sign in.\n");
} finally {
  await db.close();
}

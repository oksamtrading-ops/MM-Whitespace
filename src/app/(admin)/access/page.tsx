import type { Metadata } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden } from "../../../lib/auth/session.ts";
import Ledger from "../../_ui/Ledger.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import { setActive } from "./actions.ts";
import ActiveButton from "./ActiveButton.tsx";
import { agoLabel, daysSince, fmtDate } from "../../_ui/format.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Access review" };

/** Anything older than this is the thing an access review exists to find. */
const STALE_DAYS = 90;

export default async function AccessReview() {
  let ctx;
  try {
    ctx = await requireRole(["admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="The access review is for Admins."
                 action={{ href: "/dashboard", label: "Go to the dashboard" }} />
      : <Refusal title="Sign in" body="Whitespace is invite-only."
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const users = await ctx.db.all(`select id, email, role, is_active, last_sign_in_at, created_at
       from app_users order by is_active desc, email`) as Array<{
    id: string; email: string; role: string; is_active: number;
    last_sign_in_at: string | null; created_at: string;
  }>;

  const now = Date.now();
  const daysAgo = (iso: string | null) => (iso === null ? null : daysSince(iso, now));

  const active = users.filter((u) => u.is_active);
  const stale = active.filter((u) => {
    const d = daysAgo(u.last_sign_in_at);
    return d === null || d > STALE_DAYS;
  });

  return (
    <div className="reading">
      <h1 className="rise">Access review</h1>
      <p className="sub rise">
        Whitespace sits outside Deloitte&rsquo;s own estate, so there is no leaver process
        behind it. Deactivating an account here is the only thing that removes access.
      </p>

      <div className="rise" style={{ "--i": 1 } as React.CSSProperties}>
        <Ledger items={[
          { value: active.length, label: "Active" },
          { value: users.length - active.length, label: "Deactivated", quiet: true },
          { value: stale.length, label: `Not seen in ${STALE_DAYS} days` },
        ]} />
      </div>

      {stale.length > 0 && (
        <div className="notice rise" role="status" style={{ "--i": 2 } as React.CSSProperties}>
          <b>{stale.length} active account{stale.length === 1 ? "" : "s"} to review</b>
          <span>Never signed in, or not seen for more than {STALE_DAYS} days. Each is one click from deactivation below.</span>
        </div>
      )}

      <Section id="accounts" title="Accounts" index={3}>
        <table className="accounts">
          <caption>Every change is written to the audit log with the actor and the target.</caption>
          <thead>
            <tr><th>Email</th><th>Role</th><th>Last sign-in</th><th>Status</th>
                <th><span className="sr-only">Action</span></th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const days = daysAgo(u.last_sign_in_at);
              const isStale = u.is_active === 1 && (days === null || days > STALE_DAYS);
              const self = u.id === ctx.user.id;
              return (
                <tr key={u.id}>
                  <td>{u.email}{self && <span className="pill quiet you">you</span>}</td>
                  <td style={{ textTransform: "capitalize" }}>{u.role}</td>
                  <td>
                    {u.last_sign_in_at
                      ? <>{fmtDate(u.last_sign_in_at)}{" "}
                          {/* One expression, so React does not split the parens off into their
                              own text nodes with comment markers between them. */}
                          <span className="meta">{`(${agoLabel(days as number)})`}</span></>
                      : <span className="meta">never</span>}
                    {isStale && <> <span className="pill warn">review</span></>}
                  </td>
                  <td>
                    {u.is_active
                      ? <span className="pill ok">active</span>
                      : <span className="pill no">deactivated</span>}
                  </td>
                  <td>
                    <form action={setActive} className="inline">
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="active" value={u.is_active ? "0" : "1"} />
                      <ActiveButton label={u.is_active ? "Deactivate" : "Reactivate"}
                                    disabled={self && u.is_active === 1} />
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

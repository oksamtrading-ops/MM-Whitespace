import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden } from "../../../lib/auth/session.ts";
import { setActive } from "./actions.ts";

export const dynamic = "force-dynamic";

/** Anything older than this is the thing an access review exists to find. */
const STALE_DAYS = 90;

export default async function AccessReview() {
  let ctx;
  try {
    ctx = await requireRole(["admin"]);
  } catch (err) {
    return (
      <>
        <h1>{err instanceof Forbidden ? "Not permitted" : "Sign in"}</h1>
        <div className="empty">
          <p>{err instanceof Forbidden
            ? "The access review is Admin only."
            : "This application is invite-only."}</p>
        </div>
      </>
    );
  }

  const users = ctx.db.prepare(
    `select id, email, role, is_active, last_sign_in_at, created_at
       from app_users order by is_active desc, email`).all() as Array<{
    id: string; email: string; role: string; is_active: number;
    last_sign_in_at: string | null; created_at: string;
  }>;

  const now = Date.now();
  const daysSince = (iso: string | null) =>
    iso === null ? null : Math.floor((now - new Date(iso.replace(" ", "T")).getTime()) / 86_400_000);

  const active = users.filter((u) => u.is_active);
  const stale = active.filter((u) => {
    const d = daysSince(u.last_sign_in_at);
    return d === null || d > STALE_DAYS;
  });

  return (
    <>
      <h1>Access review</h1>
      <p className="sub">
        There is no leaver process for an application outside Deloitte&rsquo;s own estate, so
        deactivation here is the only thing standing between a partner who rolls off and
        the client roster. Signed in as {ctx.user.email}.
      </p>

      <div className="cards">
        <div className="card"><div className="n">{active.length}</div><div className="k">Active</div></div>
        <div className="card"><div className="n">{users.length - active.length}</div><div className="k">Deactivated</div></div>
        <div className="card"><div className="n">{stale.length}</div><div className="k">Not seen in {STALE_DAYS} days</div></div>
      </div>

      {stale.length > 0 && (
        <div className="banner" role="status">
          <b>{stale.length} active account{stale.length === 1 ? "" : "s"} to review</b>
          Never signed in, or not seen for more than {STALE_DAYS} days. Each is one click
          from deactivation below.
        </div>
      )}

      <table>
        <caption className="sub" style={{ captionSide: "bottom", textAlign: "left" }}>
          Every change is written to the audit log with the actor and the target.
        </caption>
        <thead>
          <tr><th>Email</th><th>Role</th><th>Last sign-in</th><th>Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const days = daysSince(u.last_sign_in_at);
            const isStale = u.is_active === 1 && (days === null || days > STALE_DAYS);
            return (
              <tr key={u.id}>
                <td>{u.email}{u.id === ctx.user.id && <span className="tag done"> you</span>}</td>
                <td>{u.role}</td>
                <td>
                  {u.last_sign_in_at
                    ? <>{u.last_sign_in_at.slice(0, 10)}{" "}
                        <span className="sub">({days}d ago)</span></>
                    : <span className="sub">never</span>}
                  {isStale && <span className="tag warn"> review</span>}
                </td>
                <td>
                  {u.is_active
                    ? <span className="pill ok">active</span>
                    : <span className="pill no">deactivated</span>}
                </td>
                <td>
                  <form action={setActive}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="active" value={u.is_active ? "0" : "1"} />
                    <button type="submit" className="linkbtn"
                            disabled={u.id === ctx.user.id && u.is_active === 1}>
                      {u.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

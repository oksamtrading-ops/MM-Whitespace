import type { Metadata } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden } from "../../../lib/auth/session.ts";
import Callout from "../../_ui/Callout.tsx";
import Icon from "../../_ui/Icon.tsx";
import Page from "../../_ui/Page.tsx";
import Panel, { StatRow } from "../../_ui/Panel.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import { setActive } from "./actions.ts";
import ActiveButton from "./ActiveButton.tsx";
import TempPasswordButton from "./TempPasswordButton.tsx";
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
    <Page title="Access review" count={users.length}>
    <div className="reading">
      <p className="sub rise">
        Whitespace sits outside Deloitte&rsquo;s own estate, so there is no leaver process
        behind it. Deactivating an account here is the only thing that removes access.
      </p>

      <div className="rise" style={{ "--i": 1 } as React.CSSProperties}>
        <Panel icon="users" title="Accounts" bare>
          <StatRow items={[
            { value: active.length, label: "Active", icon: "circle-check" },
            { value: users.length - active.length, label: "Deactivated", icon: "user-x", quiet: true },
            { value: stale.length, label: `Not seen in ${STALE_DAYS} days`, icon: "clock-alert" },
          ]} />
        </Panel>
      </div>

      {stale.length > 0 && (
        <div className="rise" style={{ "--i": 2 } as React.CSSProperties}>
          <Callout tone="warn" live
                   title={`${stale.length} active account${stale.length === 1 ? "" : "s"} to review`}>
            Never signed in, or not seen for more than {STALE_DAYS} days. Each is one click from
            deactivation below.
          </Callout>
        </div>
      )}

      <Section id="accounts" title="Accounts" index={3}>
        <table className="accounts">
          <caption>Every change is written to the audit log with the actor and the target.</caption>
          <thead>
            <tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Last sign-in</th>
                <th scope="col">Status</th>
                <th scope="col" className="act"><span className="sr-only">Action</span></th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const days = daysAgo(u.last_sign_in_at);
              const isStale = u.is_active === 1 && (days === null || days > STALE_DAYS);
              const self = u.id === ctx.user.id;
              return (
                <tr key={u.id}>
                  <th scope="row">{u.email}{self && <span className="pill quiet you">you</span>}</th>
                  <td style={{ textTransform: "capitalize" }}>{u.role}</td>
                  <td>
                    {u.last_sign_in_at
                      ? <>{fmtDate(u.last_sign_in_at)}{" "}
                          {/* One expression, so React does not split the parens off into their
                              own text nodes with comment markers between them. */}
                          <span className="meta">{`(${agoLabel(days as number)})`}</span></>
                      : <span className="meta">never</span>}
                    {isStale && <> <span className="pill warn"><Icon name="clock-alert" size={12} />review</span></>}
                  </td>
                  <td>
                    {u.is_active
                      ? <span className="pill ok"><Icon name="circle-check" size={12} />active</span>
                      : <span className="pill no"><Icon name="user-x" size={12} />deactivated</span>}
                  </td>
                  <td className="act">
                    <form action={setActive} className="inline">
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="active" value={u.is_active ? "0" : "1"} />
                      <ActiveButton label={u.is_active ? "Deactivate" : "Reactivate"}
                                    disabled={self && u.is_active === 1} />
                    </form>
                    {/* Not offered for yourself: it would revoke your own
                        session mid-request. /password is where an Admin
                        changes their own. Not offered for a deactivated
                        account either -- giving somebody a credential for an
                        account that refuses them is a way to look like access
                        was restored when it was not. */}
                    {!self && u.is_active === 1 && <TempPasswordButton userId={u.id} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
    </div>
    </Page>
  );
}

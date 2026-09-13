import Link from "next/link";
import type { Route } from "next";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "../../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../../lib/auth/session.ts";
import { getPursuit, vocabulary } from "../../../../lib/pursuit/index.ts";
import Refusal from "../../../_ui/Refusal.tsx";
import Icon from "../../../_ui/Icon.tsx";
import Page from "../../../_ui/Page.tsx";
import Section from "../../../_ui/Section.tsx";
import Facts from "../../../_ui/Facts.tsx";
import { fmtDate } from "../../../_ui/format.ts";
import PursuitDesk, { type Person } from "./PursuitDesk.tsx";
import ActionsTable from "./ActionsTable.tsx";
import Callout from "../../../_ui/Callout.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pursuit" };

export default async function Pursuit({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireRole(["analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted"
                 body="Pursuits are Deloitte-internal and are kept to Analysts and Admins. Your account is a Viewer, which opens the published dashboard."
                 action={{ href: "/dashboard", label: "Go to the dashboard" }} />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const { id } = await params;
  const found = await getPursuit(ctx.db, id);
  if (!found) notFound();
  const { pursuit, notes, actions } = found;
  const v = await vocabulary(ctx.db);

  // Only people who can actually sign in, because an owner who cannot is not
  // an owner -- the same rule the domain enforces on the way in.
  const people = (await ctx.db.all(
    `select id, email from app_users where is_active and role in ('analyst','admin')
      order by email`) as Array<{ id: string; email: string }>)
    .map((p): Person => ({ id: String(p.id), email: String(p.email) }));

  return (
    <Page title={pursuit.companyName}
          back={{ href: "/pursuits", label: "Pursuits" }}
          meta={pursuit.closedAt ? `Closed · ${pursuit.outcome}` : (pursuit.priority ?? "No priority set")}
          actions={<Link className="btn sm secondary" href={`/companies/${pursuit.companyId}` as Route} prefetch={false}>
                     <Icon name="building-2" size={13} />Company profile
                   </Link>}>
      <p className="lede">
        The practice&rsquo;s own judgement about this company.{" "}
        <Link href={`/companies/${pursuit.companyId}` as Route}>The evidence is on its profile</Link>,
        which is what a partner reads before the conversation.
      </p>

      <Facts items={[
        { label: "Priority", value: pursuit.priority ?? "not set" },
        { label: "Owner", value: pursuit.ownerEmail ?? "unassigned" },
        { label: "Open actions", value: pursuit.openActions, figure: true },
        { label: "Opened", value: fmtDate(pursuit.createdAt) },
        ...(pursuit.closedAt
          ? [{ label: "Closed", value: `${pursuit.outcome} · ${fmtDate(pursuit.closedAt)}` }]
          : []),
      ]} />

      {pursuit.closedAt && (
        <Callout tone="info" live title={<>Closed as “{pursuit.outcome}”{pursuit.outcomeRetired && " — an outcome no longer in use"}.</>}>{pursuit.closedByEmail ? `${pursuit.closedByEmail} closed it. ` : ""}
            Everything below stands as it was.</Callout>
      )}

      {pursuit.priorityRetired && (
        <Callout tone="danger" title={<>{pursuit.priority} is no longer one of the priorities in use.</>}>It stands as the judgement that was made. Setting a new one replaces it;
            nothing rewrites it on its own.</Callout>
      )}

      <Section id="desk" title={pursuit.closedAt ? "This pursuit is closed" : "Record what happened"}
               caption="Notes and actions are never edited or deleted: a note is somebody's judgement at a moment, and an action that was abandoned is a fact about the pursuit.">
        <PursuitDesk pursuitId={pursuit.id} vocabulary={v} people={people}
                     priority={pursuit.priority} ownerId={pursuit.ownerId}
                     outcome={pursuit.outcome} closed={pursuit.closedAt !== null} />
      </Section>

      <Section id="actions" title="Actions" index={1}
               caption={actions.length === 0 ? "None yet." : undefined}>
        {actions.length > 0 && (
          <ActionsTable pursuitId={pursuit.id} actions={actions} vocabulary={v}
                        people={people} />
        )}
      </Section>

      <Section id="notes" title="Notes" index={2}
               caption={notes.length === 0 ? "None yet." : "Newest first."}>
        {notes.length > 0 && (
          <ol className="ledger">
            {notes.map((n) => (
              <li key={n.id}>
                <p>{n.body}</p>
                <p className="meta">
                  {n.authorEmail ?? "unknown"} · {fmtDate(n.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </Page>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { listRuns, PHASE_COPY, type RunStatus } from "../../../lib/enrich/runstatus.ts";
import Facts from "../../_ui/Facts.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import { fmtDate, fmtMoney, periodName } from "../../_ui/format.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Runs" };

/** Ordered as the work moves, so the bar reads left to right. */
const STATE_ORDER = [
  "completed", "persisting", "awaiting_batch", "researching", "claimed",
  "queued", "halted", "dead_letter",
];
const STATE_LABEL: Record<string, string> = {
  queued: "Queued", claimed: "Claimed", researching: "Researching",
  awaiting_batch: "Awaiting batch", persisting: "Persisting", completed: "Completed",
  halted: "Halted", dead_letter: "Abandoned",
};

const ALARMING = new Set<string>(["stalled", "halted", "failed"]);

export default async function Runs() {
  let ctx;
  try {
    ctx = await requireRole(["analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted"
                 body="Enrichment runs are for Analysts and Admins. Your account is a Viewer, which opens the published dashboard."
                 action={{ href: "/dashboard", label: "Go to the dashboard" }} />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const period = await ctx.db.get(
    "select id, label from periods order by market_cap_as_of desc limit 1",
  ) as { id: string; label: string } | undefined;
  if (!period) {
    return <Refusal title="No period yet"
                    body="A run belongs to a period, and none has been committed."
                    action={{ href: "/upload", label: "Upload a workbook" }} />;
  }

  const runs = await listRuns(ctx.db, period.id);
  if (runs.length === 0) {
    return (
      <div className="reading rise">
        <h1>Runs</h1>
        <p className="sub">
          No enrichment has run against {periodName(period.label).name}. This build is
          replay-only: live research needs credentials and the account-tier spike.
        </p>
        <p className="empty">
          When a run starts, this page names what it is doing — queued, running, stalled,
          awaiting batch, halted, completed, or completed with errors. Never a spinner.
        </p>
      </div>
    );
  }

  const [current, ...earlier] = runs;

  return (
    <div className="withrail">
      <div className="reading">
        <h1 className="rise">Runs</h1>
        <p className="sub rise">
          What enrichment is doing, in the words it would use to explain itself.
        </p>

        <div className={`notice rise${ALARMING.has(current.phase) ? " alert" : current.phase.startsWith("completed") ? " ok" : ""}`}
             role="status">
          <b>{PHASE_COPY[current.phase].label}</b>
          <span>{PHASE_COPY[current.phase].detail}</span>
        </div>

        {current.haltReason && (
          <p className="note rise"><b>Reason:</b> {current.haltReason}</p>
        )}

        <Section id="progress" title="Progress" index={1}
                 caption={`${current.finished} of ${current.total} jobs have finished. A job is finished when it completed, halted, or was abandoned.`}>
          <StateBar run={current} />
          <table>
            <thead><tr><th>State</th><th className="n">Jobs</th><th>Meaning</th></tr></thead>
            <tbody>
              {STATE_ORDER.filter((s) => current.counts.some((c) => c.state === s)).map((s) => (
                <tr key={s}>
                  <td>{STATE_LABEL[s] ?? s}</td>
                  <td className="n">{current.counts.find((c) => c.state === s)!.n}</td>
                  <td className="meta">{STATE_MEANING[s]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section id="spend" title="Spend against the cap" index={2}
                 caption="A run cannot exist without a budget. It warns at 80% and halts at 100%.">
          <div className="gauges">
            <div className={`gauge${current.budget.halt ? " over" : current.budget.warn ? " warn" : ""}`}>
              <span className="lab">Spent</span>
              <span className="track" role="img"
                    aria-label={`${Math.round(current.budget.pct * 100)} percent of the budget spent`}>
                <span className="fill" style={{ width: `${Math.min(100, Math.max(0.5, current.budget.pct * 100))}%` }} />
                <span className="floor" style={{ left: "80%" }} aria-hidden="true"><span>80%</span></span>
              </span>
              <span className="figs">
                <span className="fig">{fmtMoney(current.budget.spend)}</span>
                <span className="of fig-sm">{`of ${fmtMoney(current.budget.budget)}`}</span>
              </span>
            </div>
          </div>
        </Section>

        {current.expiredLeases > 0 && (
          <Section id="leases" title="Leases that ran out" index={3}
                   caption="A worker is still recorded as holding these, and its lease has expired.">
            <p>
              <span className="fig-lg">{current.expiredLeases}</span> job
              {current.expiredLeases === 1 ? "" : "s"}.{" "}
              The next tick returns them to the queue and <b>charges no attempt</b>, so
              reaping is safe to repeat and will not exhaust a job.
            </p>
          </Section>
        )}

        {current.deadLetters.length > 0 && (
          <Section id="abandoned" title="Abandoned" index={4}
                   caption="These exhausted their attempts. They are not stalled; they are finished and wrong.">
            <table>
              <thead><tr><th>Company</th><th>Fields</th><th className="n">Attempts</th><th>Last error</th></tr></thead>
              <tbody>
                {current.deadLetters.map((d, i) => (
                  <tr key={i}>
                    <td>{d.companyName}</td>
                    <td className="meta">{d.fieldGroup}</td>
                    <td className="n">{d.attempts}</td>
                    <td className="meta">{d.lastError ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {earlier.length > 0 && (
          <Section id="earlier" title="Earlier runs" index={5}>
            <table>
              <thead>
                <tr><th>Started</th><th>State</th><th className="n">Jobs</th><th className="n">Spend</th><th>Mode</th></tr>
              </thead>
              <tbody>
                {earlier.map((r) => (
                  <tr key={r.runId}>
                    <td>{fmtDate(r.createdAt)}</td>
                    <td>
                      <span className={`pill ${ALARMING.has(r.phase) ? "no" : r.phase.startsWith("completed") ? "ok" : "quiet"}`}>
                        {PHASE_COPY[r.phase].label}
                      </span>
                    </td>
                    <td className="n">{r.finished}/{r.total}</td>
                    <td className="n">{fmtMoney(r.budget.spend)}</td>
                    <td className="meta">{r.mode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
      </div>

      <aside className="rail rise" aria-label="About this run">
        <p className="k">This run</p>
        <Facts items={[
          { label: "State", value: PHASE_COPY[current.phase].label, figure: true },
          { label: "Started", value: fmtDate(current.createdAt) },
          { label: "Last movement", value: since(current.secondsSinceProgress) },
          { label: "Mode", value: <span className="pill quiet">{current.mode}</span> },
          { label: "Model", value: current.model },
          { label: "Prompt", value: <code>{current.promptVersion}</code> },
          ...(current.createdBy ? [{ label: "Started by", value: current.createdBy }] : []),
        ]} />
        <p className="meta" style={{ marginTop: 20 }}>
          A stalled or halted run is diagnosed in the runbook, not by restarting it.{" "}
          <Link href="/review" prefetch={false}>Review board →</Link>
        </p>
      </aside>
    </div>
  );
}

const STATE_MEANING: Record<string, string> = {
  queued: "waiting for a worker",
  claimed: "a worker has taken it and holds a lease",
  researching: "the model is working on it",
  awaiting_batch: "submitted to the batch API, waiting on results",
  persisting: "results are being written",
  completed: "done",
  halted: "stopped with the run",
  dead_letter: "attempts exhausted and abandoned",
};

function since(seconds: number | null): string {
  if (seconds === null) return "nothing yet";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

/** One bar, segmented by state, with every segment directly labelled. */
function StateBar({ run }: { run: RunStatus }) {
  const segments = STATE_ORDER
    .map((state) => ({ state, n: run.counts.find((c) => c.state === state)?.n ?? 0 }))
    .filter((s) => s.n > 0);
  return (
    <div className="statebar" role="img"
         aria-label={segments.map((s) => `${s.n} ${STATE_LABEL[s.state] ?? s.state}`).join(", ")}>
      {segments.map((s) => (
        <span key={s.state} className={`seg ${s.state}`} style={{ flexGrow: s.n }}>
          <span className="sr-only">{STATE_LABEL[s.state]}</span>
        </span>
      ))}
    </div>
  );
}

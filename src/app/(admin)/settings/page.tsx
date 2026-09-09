import Link from "next/link";
import type { Metadata } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { readSettings } from "../../../lib/settings/index.ts";
import Facts from "../../_ui/Facts.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import { fmtDate, fmtInt, periodName } from "../../_ui/format.ts";
import SettingsForm from "./SettingsForm.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function Settings() {
  let ctx;
  try {
    ctx = await requireRole(["admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="Settings are for Admins."
                 action={{ href: "/dashboard", label: "Go to the dashboard" }} />
      : <Refusal title="Sign in" body="Whitespace is invite-only."
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const settings = readSettings(ctx.db);
  const period = ctx.db.prepare(
    `select label, status, threshold_amount, threshold_operator, threshold_currency,
            proximity_band_pct from periods order by market_cap_as_of desc limit 1`,
  ).get() as {
    label: string; status: string; threshold_amount: number; threshold_operator: string;
    threshold_currency: string; proximity_band_pct: number;
  } | undefined;

  const floors = ctx.db.prepare(
    "select chart, label, driving_field, floor_pct, blocks_publish from coverage_floors order by chart",
  ).all() as Array<{ chart: string; label: string; driving_field: string;
                     floor_pct: number | null; blocks_publish: number }>;
  const ceiling = ctx.db.prepare(
    "select value from publish_thresholds where key = 'max_hallucination_rate'").get() as
    { value: number } | undefined;

  const changes = ctx.db.prepare(
    `select a.detail, a.created_at, u.email
       from audit_log a left join app_users u on u.id = a.actor_id
      where a.event = 'setting_changed' order by a.created_at desc limit 8`,
  ).all() as Array<{ detail: string; created_at: string; email: string | null }>;

  return (
    <div className="withrail">
      <div className="reading">
        <h1 className="rise">Settings</h1>
        <p className="sub rise">
          What the practice has decided, in the two places it can be decided. Everything
          else on this page is policy the interface will not quietly move.
        </p>

        <Section id="defaults" title="Defaults for the next period" index={1}
                 caption="A commit copies these onto the period it creates. From that moment they belong to that period and are part of what it publishes.">
          <SettingsForm settings={settings} />
        </Section>

        {period && (
          <Section id="current" title={`${periodName(period.label).name}, as committed`} index={2}
                   caption="Read-only. Editing what a period was measured against would leave a frozen snapshot disagreeing with the header above it.">
            <Facts items={[
              { label: "Threshold", value:
                  `${period.threshold_currency} ${fmtInt(Number(period.threshold_amount))}`, figure: true },
              { label: "Operator", value: period.threshold_operator === "gte" ? "At or above" : "Above" },
              { label: "Proximity band", value: `±${Number(period.proximity_band_pct)}%`, figure: true },
              { label: "Status", value: (
                  <span className={`pill ${period.status === "published" ? "ok" : "warn"}`}>{period.status}</span>
                ) },
            ]} />
          </Section>
        )}

        <Section id="floors" title="Coverage floors" index={3}
                 caption="Not editable here, and that is the design. A chart below its floor is replaced by a gauge and blocks a publish; the way past it is an override with a recorded reason that prints on the dashboard header. A quietly lowered floor is the same decision with nobody named against it.">
          <table>
            <thead>
              <tr><th>Chart</th><th>Driven by</th><th className="n">Floor</th><th>Blocks publish</th></tr>
            </thead>
            <tbody>
              {floors.map((f) => (
                <tr key={f.chart}>
                  <td>{f.label}</td>
                  <td className="meta"><code>{f.driving_field}</code></td>
                  <td className="n">{f.floor_pct === null ? "—" : `${Number(f.floor_pct)}%`}</td>
                  <td>{f.blocks_publish
                    ? <span className="pill quiet">yes</span>
                    : <span className="pill quiet">no</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            <b>Fees carry no percentage floor.</b> “Found for 61 of 259” is honest, where
            “24%” invites the question of what the other 76% are — and the answer is not
            “no fees” but “not disclosed anywhere we may look”.
          </p>
        </Section>

        <Section id="ceiling" title="Fabrication ceiling" index={4}
                 caption="The share of a run's assessed findings that may fail grounding before a publish is blocked.">
          <Facts items={[
            { label: "Ceiling", value: `${((ceiling?.value ?? 0.02) * 100).toFixed(1)}%`, figure: true },
          ]} />
          <p className="note">
            An abstention is not a fabrication. A model that says the document does not
            disclose this is behaving correctly, and is excluded from the rate.
          </p>
        </Section>

        {changes.length > 0 && (
          <Section id="history" title="Recent changes" index={5}
                   caption="One line per setting changed, not one per save.">
            <table>
              <thead><tr><th>Setting</th><th>From</th><th>To</th><th>By</th><th>When</th></tr></thead>
              <tbody>
                {changes.map((c, i) => {
                  const d = safeDetail(c.detail);
                  return (
                    <tr key={i}>
                      <td className="meta"><code>{d.key}</code></td>
                      <td className="meta">{d.from ?? "—"}</td>
                      <td>{d.to}</td>
                      <td className="meta">{c.email ?? "—"}</td>
                      <td className="meta">{fmtDate(c.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        )}
      </div>

      <aside className="rail rise" aria-label="Other admin screens">
        <p className="k">Also yours</p>
        <ul className="steps" style={{ counterReset: "none" }}>
          <li style={{ paddingLeft: 0 }}>
            <b><Link href="/access" prefetch={false}>Access review</Link></b>
            <span>Who has an account, what they may do, and who has not signed in.</span>
          </li>
          <li style={{ paddingLeft: 0 }}>
            <b><Link href="/publish" prefetch={false}>Publish</Link></b>
            <span>Including the override, which is the sanctioned way past a blocked gate.</span>
          </li>
        </ul>
      </aside>
    </div>
  );
}

function safeDetail(detail: string): { key: string; from: string | null; to: string } {
  try {
    const d = JSON.parse(detail) as { key: string; from: string | null; to: string };
    return { key: d.key, from: d.from ?? null, to: String(d.to) };
  } catch {
    return { key: "—", from: null, to: detail };
  }
}

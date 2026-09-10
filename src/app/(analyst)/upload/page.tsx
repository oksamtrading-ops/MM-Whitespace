import type { Metadata } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import Facts from "../../_ui/Facts.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import { fmtDate, periodName } from "../../_ui/format.ts";
import UploadForm from "./UploadForm.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Upload" };

export default async function Upload() {
  let ctx;
  try {
    ctx = await requireRole(["analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted"
                 body="Uploading a workbook is for Analysts and Admins. Your account is a Viewer, which opens the published dashboard."
                 action={{ href: "/dashboard", label: "Go to the dashboard" }} />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const latest = await ctx.db.get("select label, status, market_cap_as_of from periods order by market_cap_as_of desc limit 1") as { label: string; status: string; market_cap_as_of: string } | undefined;

  return (
    <div className="withrail">
      <div className="reading">
        <h1 className="rise">Upload a workbook</h1>
        <p className="sub rise">
          The quarter starts here. The workbook is read and checked; nothing reaches the
          database until you have seen what it found.
        </p>
        <Section id="choose" title="Choose the workbook" index={1}>
          <UploadForm />
        </Section>
      </div>

      <aside className="rail rise" aria-label="What happens next">
        <p className="k">What happens</p>
        <ol className="steps">
          <li><b>Read</b><span>The workbook is parsed in place and deleted. Nothing is stored.</span></li>
          <li><b>Check</b><span>A validation report: blocking findings, warnings, and proof totals that must tie.</span></li>
          <li><b>Commit</b><span>You name the period and confirm. Only then is anything written.</span></li>
        </ol>
        {latest && (
          <>
            <p className="k" style={{ marginTop: 28 }}>Latest period</p>
            <Facts items={[
              { label: "Period", value: periodName(latest.label).name, figure: true },
              { label: "Market cap as of", value: fmtDate(latest.market_cap_as_of) },
              { label: "Status", value: (
                  <span className={`pill ${latest.status === "published" ? "ok" : "warn"}`}>{latest.status}</span>
                ) },
            ]} />
          </>
        )}
      </aside>
    </div>
  );
}

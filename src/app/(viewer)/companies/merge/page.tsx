import Link from "next/link";
import type { Metadata, Route } from "next";
import { requireRole } from "../../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../../lib/auth/session.ts";
import {
  findDuplicateCandidates, mergePreview, MergeRefused, reasonLabel,
} from "../../../../lib/identity/merge.ts";
import Refusal from "../../../_ui/Refusal.tsx";
import Section from "../../../_ui/Section.tsx";
import MergeForm from "./MergeForm.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Possible duplicates" };

const STRENGTH_WORD: Record<number, string> = { 1: "strong", 2: "recorded", 3: "a hunch" };

export default async function Merge(
  { searchParams }: { searchParams: Promise<{ a?: string; b?: string }> },
) {
  let ctx;
  try {
    ctx = await requireRole(["analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted"
                 body="Resolving identity is for Analysts and Admins. Your account is a Viewer, which opens the published dashboard."
                 action={{ href: "/dashboard", label: "Go to the dashboard" }} />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const isAdmin = ctx.user.role === "admin";
  const { a, b } = await searchParams;
  const candidates = await findDuplicateCandidates(ctx.db);

  let pair = null;
  let blocked: string | null = null;
  if (a && b) {
    try {
      pair = mergePreview(ctx.db, a, b);
      if ((await pair).overlappingPeriods.length > 0) {
        blocked = `Both hold data in ${(await pair).overlappingPeriods.join(", ")}. Two companies in ` +
                  `one period are two companies, not one recorded twice.`;
      } else if (!isAdmin) {
        blocked = "An Admin performs the merge. You can say these are one company; " +
                  "the act that moves a period's data is signed for.";
      }
    } catch (err) {
      if (err instanceof MergeRefused) blocked = err.message;
      else throw err;
    }
  }

  return (
    <div className="reading">
      <p className="crumb rise"><Link href="/companies" prefetch={false}>← Companies</Link></p>
      <h1 className="rise">Possible duplicates</h1>
      <p className="sub rise">
        The workbook carries no rename history, so a company that changes its name arrives
        as a second row and its history stops there. These are pairs that look like one
        company. None of them is one until somebody says so.
      </p>

      {pair && (
        <Section id="pair" title={`${(await pair).loser.name} and ${(await pair).winner.name}`} index={1}
                 caption="A merge is a redirect, not a deletion: the row merged away keeps its id, so every frozen snapshot that pointed at it still resolves.">
          <table>
            <thead><tr><th>What moves</th><th className="n">Rows</th></tr></thead>
            <tbody>
              {(await pair).moves.length === 0
                ? <tr><td colSpan={2} className="meta">Nothing is recorded against it yet.</td></tr>
                :(await pair).moves.map((m) => (
                    <tr key={m.table}>
                      <td><code>{m.table}</code></td>
                      <td className="n">{m.rows}</td>
                    </tr>
                  ))}
              {(await pair).duplicates > 0 && (
                <tr>
                  <td className="meta">already recorded on the other, so dropped</td>
                  <td className="n">{(await pair).duplicates}</td>
                </tr>
              )}
              <tr>
                <td className="meta">published rows, left exactly as published</td>
                <td className="n">{(await pair).frozenRevisions}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 24 }}>
            <MergeForm a={{ id:(await pair).winner.id, name:(await pair).winner.name }}
                       b={{ id:(await pair).loser.id, name:(await pair).loser.name }}
                       blocked={blocked} />
          </div>
        </Section>
      )}

      <Section id="candidates" title="Candidates" index={2}
               caption={candidates.length === 0
                 ? "Nothing looks duplicated. Every company in the population has one row."
                 : "Strongest evidence first. An identifier is evidence; a similar name is a hunch, and is labelled as one."}>
        {candidates.length > 0 && (
          <table>
            <thead>
              <tr><th>One company?</th><th>Why</th><th>Evidence</th><th></th></tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={`${c.aId}:${c.bId}`}>
                  <td>{c.aName}<br /><span className="meta">{c.bName}</span></td>
                  <td>{reasonLabel(c.reason)}<br />
                    <span className="meta">{c.detail}</span></td>
                  <td>
                    <span className={`pill ${c.strength === 1 ? "ok" : c.strength === 2 ? "quiet" : "warn"}`}>
                      {STRENGTH_WORD[c.strength]}
                    </span>
                  </td>
                  <td>
                    <Link className="btn quiet"
                          href={`/companies/merge?a=${c.aId}&b=${c.bId}` as Route}
                          prefetch={false}>Look</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

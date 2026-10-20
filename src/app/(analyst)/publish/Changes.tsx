import { formatFieldValue } from "../../../lib/format/fields.ts";
import { FOOTPRINT_WORD, STAGE_LABEL, TIER_WORD } from "../../../lib/profile/roster.ts";
import type { RevisionChanges, TierChange } from "../../../lib/publish/changes.ts";
import Callout from "../../_ui/Callout.tsx";

/** Where a value came from, in the words the company page uses for its citations. */
const SOURCE_WORD: Record<string, string> = {
  extract: "workbook", ai_accepted: "research", manual_override: "override",
  manual_entry: "entered", derived: "rules", inherited: "carried",
};

/** Rows per field before the rest are counted rather than listed: Run 3 can change thousands. */
const PER_GROUP = 40;

type Row = { key: string; company: string; before: string; after: string };
type Group = { key: string; label: string; rows: Row[] };

function shown(fieldKey: string, v: unknown): string {
  if (fieldKey === "footprint" && typeof v === "string") return FOOTPRINT_WORD[v] ?? v;
  return formatFieldValue(fieldKey, v);
}

const withSource = (text: string, source: string | null) =>
  source && SOURCE_WORD[source] ? `${text} · ${SOURCE_WORD[source]}` : text;

function tierWord(t: TierChange["before"]): string {
  if (!t) return "—";
  return t.tier !== null ? `Tier ${t.tier}` : (TIER_WORD[t.status] ?? t.status);
}

function stageWord(stages: string[], evidence: string | null, showEvidence: boolean): string {
  const list = stages.map((s) => STAGE_LABEL[s as keyof typeof STAGE_LABEL] ?? s).join(", ") || "None";
  return showEvidence && evidence ? `${list} (${evidence})` : list;
}

/**
 * The next revision against the one standing, one table grouped by field.
 *
 * A server component with no client state: it is read once, before the
 * reason is typed, which is the moment it is for.
 */
export default function Changes({ changes, labels }: {
  changes: RevisionChanges; labels: Map<string, string>;
}) {
  const since = `revision ${changes.revision}`;
  if (changes.total === 0) {
    return (
      <Callout tone="warn" title={`Nothing has changed since ${since}`}>
        Publishing now writes a revision identical to {since}, apart from its reasons. Nothing has been
        decided in review since then, or everything decided has been undone. To correct a value, decide it
        in review first; this list then shows it.
      </Callout>
    );
  }

  const groups: Group[] = [];
  const byField = new Map<string, Row[]>();
  for (const v of changes.values) {
    byField.set(v.fieldKey, [...(byField.get(v.fieldKey) ?? []), {
      key: `${v.companyId}-${v.fieldKey}`, company: v.company,
      before: withSource(shown(v.fieldKey, v.before), v.beforeSource),
      after: withSource(shown(v.fieldKey, v.after), v.afterSource),
    }]);
  }
  for (const [fieldKey, rows] of byField) {
    groups.push({ key: fieldKey, label: labels.get(fieldKey) ?? fieldKey, rows });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));

  if (changes.stages.length > 0) {
    groups.push({
      key: "stages", label: "Stage of operations",
      rows: changes.stages.map((s) => {
        const evidenceMoved = s.evidenceBefore !== s.evidenceAfter;
        return {
          key: `${s.companyId}-stages`, company: s.company,
          before: stageWord(s.before, s.evidenceBefore, evidenceMoved),
          after: stageWord(s.after, s.evidenceAfter, evidenceMoved),
        };
      }),
    });
  }
  if (changes.tiers.length > 0) {
    groups.push({
      key: "tiers", label: "Tier",
      rows: changes.tiers.map((t) => ({
        key: `${t.companyId}-tier`, company: t.company, before: tierWord(t.before), after: tierWord(t.after),
      })),
    });
  }

  const listed = changes.total - changes.sourceOnly;
  return (
    <>
      <p className="note" style={{ marginBottom: 12 }}>
        {listed} change{listed === 1 ? "" : "s"} against {since}, compared value by value: an accept that was
        later undone does not appear, and an undo that puts back a different value does.
        {changes.sourceOnly > 0 && <> {changes.sourceOnly} more value{changes.sourceOnly === 1 ? " keeps its" : "s keep their"} value
          and change{changes.sourceOnly === 1 ? "s" : ""} only where it is cited from, usually research confirming the workbook.</>}
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Company</th>
            <th scope="col">In {since}</th>
            <th scope="col">In the next revision</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            <tr>
              <th scope="rowgroup" colSpan={3}>
                {g.label} <span className="meta">· {g.rows.length}</span>
              </th>
            </tr>
            {g.rows.slice(0, PER_GROUP).map((r) => (
              <tr key={r.key}>
                <td className="wrap">{r.company}</td>
                <td className="wrap">{r.before}</td>
                <td className="wrap">{r.after}</td>
              </tr>
            ))}
            {g.rows.length > PER_GROUP && (
              <tr>
                <td colSpan={3} className="meta">and {g.rows.length - PER_GROUP} more</td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
    </>
  );
}

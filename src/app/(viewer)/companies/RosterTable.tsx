import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import {
  auditorWord, cited, FOOTPRINT_WORD, hideKeyOf, hqWord, notFound, ROSTER_COLUMNS, STAGE_LABEL, STAGE_OF_TIER,
  stageMark, TIER_WORD, type HideKey, type MetaEntry, type RosterFilter, type RosterRow, type Shown, type SortKey,
} from "../../../lib/profile/roster.ts";
import { formatFee, formatMoney, STAGE_ORDER, type Stage } from "../../../lib/format/fields.ts";
import Icon from "../../_ui/Icon.tsx";

/**
 * The companies table itself: the rows a filter kept, in its order, with its
 * hidden columns left out. The Companies page draws it with sortable headers;
 * a saved report draws it as saved, read-only, on the server.
 */
export default function RosterTable({ shown, filter, onSort }: {
  shown: Shown[]; filter: RosterFilter; onSort?: (key: SortKey) => void;
}) {
  const hidden = new Set<HideKey>(filter.hide);
  const columns = ROSTER_COLUMNS.filter((c) => { const h = hideKeyOf(c.key); return !h || !hidden.has(h); });
  const show = (h: HideKey) => !hidden.has(h);
  const stagesShown = show("stages");

  return (
    <div className="roster">
      <table>
        <thead>
          <tr className="grouphead">
            {columns.map((c) => c.stage
              ? (c.key === STAGE_ORDER[0] &&
                  <th key="stages" scope="colgroup" colSpan={STAGE_ORDER.length} className="groupspan">Stage of operations</th>)
              : <th key={c.key} aria-hidden="true" />)}
          </tr>
          <tr className="colhead">
            {columns.map((c) => c.stage
              ? <th key={c.key} scope="col" className="stagecell">{c.label}</th>
              : (
                <th key={c.key} scope="col" className={c.numeric ? "n" : undefined}
                    aria-sort={filter.sort === c.key ? (filter.dir === 1 ? "ascending" : "descending") : "none"}>
                  {onSort ? (
                    <button type="button" className="sort" onClick={() => onSort(c.key as SortKey)}>
                      {c.label}
                      <Icon name={filter.sort === c.key && filter.dir === -1 ? "chevron-down" : "chevron-up"} size={12} />
                    </button>
                  ) : c.label}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {shown.map(({ row: r, matched }) => (
            <tr key={r.companyId}>
              <th scope="row">
                <Link href={`/companies/${r.companyId}` as Route} prefetch={false}>{r.name}</Link>
                {matched && <MatchHint entry={matched} q={filter.q} />}
              </th>
              {show("marketCap") && (
                <td className="n fig-sm">{r.marketCap === null ? "—" : formatMoney(r.marketCap, "CAD", { compact: true })}</td>
              )}
              {show("ticker") && (
                <td className="fig-sm">
                  {r.ticker ?? "—"}
                  {r.exchange && <span className="dim">{` · ${r.exchange}`}</span>}
                </td>
              )}
              {show("tier") && (
                <td>
                  {r.tier === null
                    ? <span className="pill quiet">{TIER_WORD[r.status] ?? "Unclassified"}</span>
                    : <span className="fig-sm">{`Tier ${r.tier}`}</span>}
                </td>
              )}
              {show("stage") && (
                <td>{r.tier === null ? <span className="meta">—</span> : STAGE_LABEL[STAGE_OF_TIER[r.tier]]}</td>
              )}
              {stagesShown && <StageCells row={r} />}
              {show("footprint") && <td>{FOOTPRINT_WORD[r.footprint] ?? r.footprint}</td>}
              {show("commodities") && (
                <td className="wrap">
                  <Cite row={r} field="commodities" value={r.commodities.length ? r.commodities.join(", ") : null} />
                </td>
              )}
              {show("hq") && <td><Cite row={r} field="head_office_region" value={hqWord(r)} /></td>}
              {show("auditor") && (
                <td>
                  {r.auditor === "Deloitte"
                    ? <span className="pill ok"><Icon name="landmark" size={12} />Deloitte</span>
                    : <Cite row={r} field="auditor" value={r.auditor ? auditorWord(r.auditor) : null} empty="not known" />}
                </td>
              )}
              {show("auditFee") && (
                <td className="fig-sm">
                  <Cite row={r} field="audit_fee"
                        value={r.auditFee === null || r.auditFee === undefined ? null : formatFee(r.auditFee)} />
                </td>
              )}
              {show("taxFee") && (
                <td className="fig-sm">
                  <Cite row={r} field="tax_fee"
                        value={r.taxFee === null || r.taxFee === undefined ? null : formatFee(r.taxFee)} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the marks in the table mean. */
export function RosterLegend() {
  return (
    <p className="roster-legend">
      ✓ the company operates at this stage · — not known: research has not settled it, or no published
      value · <em>Not researched</em> no stage research yet · <em>Not found</em> researched, and its filings
      do not say. A researched value links to its source on the company page. Fees are as the company
      printed them, in its reporting currency, for the fiscal year shown.
    </p>
  );
}

/**
 * The four Stage of operations cells. Blank means no ONLY where the evidence
 * is complete; a stage research has not settled shows a dash that reads "Not
 * known"; a company never researched says so once across all four, so four
 * empty cells never read as four noes.
 */
function StageCells({ row }: { row: RosterRow }) {
  const first = stageMark(row, STAGE_ORDER[0]);
  if (first === "not_researched" || first === "not_recorded") {
    return (
      <td className="stage-none" colSpan={STAGE_ORDER.length}>
        {first === "not_researched" ? "Not researched" : "Not recorded in this revision"}
      </td>
    );
  }
  return (
    <>
      {STAGE_ORDER.map((s: Stage) => {
        const mark = stageMark(row, s);
        return (
          <td key={s} className="stagecell">
            {mark === "yes" && <><span className="stage-yes" aria-hidden="true">✓</span><span className="sr-only">Yes</span></>}
            {mark === "unknown" && (
              <><span className="stage-unknown" aria-hidden="true" title="Not known">—</span><span className="sr-only">Not known</span></>
            )}
            {mark === "blank" && <span className="sr-only">No</span>}
          </td>
        );
      })}
    </>
  );
}

/**
 * A value that came from research or a reviewer links to its citation on the
 * company page; one research looked for and did not find says "Not found",
 * and links there too, because "the filings were read and do not say" is a
 * finding with a source of its own.
 */
function Cite({ row, field, value, empty = "—" }: { row: RosterRow; field: string; value: string | null; empty?: string }) {
  const href = `/companies/${row.companyId}#v-${field}` as Route;
  if (value === null || value === "") {
    if (notFound(row, field, null)) {
      return <Link className="citelink notfound" href={href} prefetch={false} title="Researched: see what was read">Not found</Link>;
    }
    return <span className="meta">{empty}</span>;
  }
  if (cited(row, field)) {
    return <Link className="citelink" href={href} prefetch={false} title="See the source">{value}</Link>;
  }
  return <>{value}</>;
}

/** Why a row matched a search that nothing on screen explains. */
function MatchHint({ entry, q }: { entry: MetaEntry; q: string }) {
  const text = entry.text;
  const at = text.toLowerCase().indexOf(q.trim().toLowerCase());
  const from = Math.max(0, at - 24);
  const snippet: ReactNode = at < 0 ? text.slice(0, 60) : (
    <>
      {from > 0 && "…"}{text.slice(from, at)}<mark>{text.slice(at, at + q.trim().length)}</mark>
      {text.slice(at + q.trim().length, at + q.trim().length + 32)}{at + q.trim().length + 32 < text.length && "…"}
    </>
  );
  return <span className="matchhint">matched: {entry.label} — {snippet}</span>;
}

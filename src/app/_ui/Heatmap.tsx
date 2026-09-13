import Icon from "./Icon.tsx";
import { FIRM_ORDER, UNKNOWN, type Matrix } from "../../lib/publish/crosstabs.ts";
import { formatMoney } from "../../lib/format/fields.ts";

/**
 * The whitespace matrix: market-cap band against incumbent auditor.
 *
 * Shading is the firm's share of the BAND, not of the whole, so a row reads
 * as "who holds this size of company" — the question the page exists to
 * answer. Three rules keep it honest:
 *
 *   - It is a real table with row and column headers, so it has its own twin.
 *     Every cell names itself: firm, band, count and denominator.
 *   - The count is in the cell, in ink chosen for that step, so the value is
 *     never carried by the fill alone.
 *   - "Not yet known" is a research gap rather than a firm. It sits outside
 *     the ramp and is hatched, so the darkest cell on the matrix is always an
 *     incumbent and the eye is not pulled to the least meaningful column.
 */
/**
 * Fixed, stated bands rather than a scale stretched to fit.
 *
 * A linear five-way split of 0-100% puts almost every cell in the first two
 * steps, because with 117 auditors unresearched no firm holds much of any
 * row — the map goes pale and says nothing. Stretching the scale silently to
 * fill the ramp would make a 12% cell look like a 40% one. So the steps are
 * named percentages and the legend prints them.
 */
const STEPS = [0.05, 0.10, 0.20, 0.35];
const STEP_LABEL = ["under 5%", "5–10%", "10–20%", "20–35%", "35% and over"];

export default function Heatmap({ matrix, currency }: { matrix: Matrix; currency: string }) {
  const { bands, totals, population } = matrix;
  const bin = (share: number) => STEPS.filter((t) => share >= t).length + 1;

  return (
    <>
      <div className="heatwrap">
        <table className="heatmap">
          <caption>
            Company count · shading is the firm&rsquo;s share of the row ·
            hatched means the auditor has not been researched
          </caption>
          <thead>
            <tr>
              <th scope="col">Market cap band</th>
              {FIRM_ORDER.map((f) => (
                <th key={f} scope="col" className="fh">
                  {f === "Deloitte" ? <span className="ours">Deloitte</span> : f}
                </th>
              ))}
              <th scope="col" className="n">Total</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.key}>
                <th scope="row">
                  {b.label}
                  <span className="sub">
                    {b.cap ? `${formatMoney(b.cap, currency, { compact: true })} · ` : ""}
                    {b.companies} companies
                  </span>
                </th>
                {b.cells.map((n, i) => {
                  const firm = FIRM_ORDER[i];
                  const share = b.companies === 0 ? 0 : n / b.companies;
                  const pct = Math.round(share * 100);
                  const label = `${firm}, ${b.label}: ${n} of ${b.companies} companies, ${pct}%`;
                  if (n === 0) {
                    return <td key={firm}><span className="cell zero" title={label}>
                      <span className="sr-only">{label}</span>
                      <span aria-hidden="true">—</span></span></td>;
                  }
                  if (firm === UNKNOWN) {
                    return <td key={firm}><span className="cell gap" title={label}>
                      <span className="sr-only">{label}</span>
                      <b aria-hidden="true">{n}</b><i aria-hidden="true">{pct}%</i></span></td>;
                  }
                  return (
                    <td key={firm}>
                      <span className={`cell q${bin(share)}`} title={label}>
                        <span className="sr-only">{label}</span>
                        <b aria-hidden="true">{n}</b><i aria-hidden="true">{pct}%</i>
                      </span>
                    </td>
                  );
                })}
                <td className="n rowtotal">{b.companies}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All bands</th>
              {totals.map((n, i) => <td key={FIRM_ORDER[i]} className="n">{n}</td>)}
              <td className="n rowtotal">{population}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="heatlegend">
        <span className="k">Share of the band</span>
        {[1, 2, 3, 4, 5].map((q) => (
          <span key={q} className="stepkey">
            <span className={`step q${q}`} aria-hidden="true" />
            <span className="meta">{STEP_LABEL[q - 1]}</span>
          </span>
        ))}
        <span className="stepkey">
          <span className="step gap" aria-hidden="true" />
          <span className="meta"><Icon name="search-x" size={12} /> not researched</span>
        </span>
      </p>
    </>
  );
}

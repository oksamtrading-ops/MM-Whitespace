/**
 * Which period a reader is shown.
 *
 * An Analyst or Admin works on the newest period, published or not: that is
 * where review, runs and publish happen. A Viewer is shown the newest period
 * that HAS been published. Before next quarter's period could be created from
 * TSX's list, every read took the newest period outright, so committing a
 * draft would have taken this quarter's dashboard and companies away from
 * every Viewer until the draft was published too.
 */
import type { Sql } from "./sql.ts";

export type PeriodRow = {
  id: string;
  label: string;
  status: string;
  market_cap_as_of: string;
  threshold_amount: number;
  threshold_currency: string;
  threshold_operator: string;
  proximity_band_pct: number;
};

const COLUMNS = `p.id, p.label, p.status, p.market_cap_as_of, p.threshold_amount, p.threshold_currency,
                 p.threshold_operator, p.proximity_band_pct`;

/** The newest period, draft or not. */
export async function newestPeriod(db: Sql): Promise<PeriodRow | undefined> {
  return await db.get(`select ${COLUMNS} from periods p order by p.market_cap_as_of desc limit 1`) as
    PeriodRow | undefined;
}

/** The newest period with at least one published revision. */
export async function newestPublishedPeriod(db: Sql): Promise<PeriodRow | undefined> {
  return await db.get(`select ${COLUMNS} from periods p
      where exists (select 1 from period_publications pp where pp.period_id = p.id)
      order by p.market_cap_as_of desc limit 1`) as PeriodRow | undefined;
}

/** The period a reader sees: the newest for a role allowed a draft, else the newest published. */
export async function shownPeriod(db: Sql, opts: { allowDraft: boolean }): Promise<PeriodRow | undefined> {
  return opts.allowDraft ? await newestPeriod(db) : await newestPublishedPeriod(db);
}

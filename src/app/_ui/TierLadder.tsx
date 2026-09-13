import Link from "next/link";
import type { Route } from "next";
import Icon, { type IconName } from "./Icon.tsx";

export type Rung = {
  tier: number;
  rule: string;
  detail: string;
  /** The real, computable population this tier will be drawn from. */
  basis: string;
  /** The count, once research has resolved it. Null while it is outstanding. */
  n: number | null;
  icon: IconName;
};

/**
 * The tier ladder, in place of a meter.
 *
 * Below its coverage floor the tier chart must not be drawn — doc 09 is right
 * and nothing here changes it. But a progress bar where a chart should be
 * teaches the reader nothing while they wait. The ladder shows what the six
 * tiers mean, the footprint population each will be drawn from (which IS
 * computable today), and the one tier already resolved. The gate notice sits
 * underneath, so the refusal is still stated rather than implied.
 */
export default function TierLadder({ rungs, gate }: {
  rungs: Rung[];
  gate?: { resolved: number; population: number; floorPct: number | null; reviewLink?: string; canReview: boolean };
}) {
  return (
    <div className="ladder">
      {rungs.map((r) => (
        <div key={r.tier} className={`rung${r.n === null ? " pending" : ""}`}>
          <span className={`badge t${r.tier}`}>{`Tier ${r.tier}`}</span>
          <span className="what">
            <b>{r.rule}</b>
            <span className="detail">{r.detail}</span>
          </span>
          <span className="basis"><Icon name={r.icon} size={13} />{r.basis}</span>
          <span className="count">
            {r.n === null
              ? <span className="await">awaiting stage</span>
              : <span className="fig-md">{r.n}</span>}
          </span>
        </div>
      ))}
      {gate && gate.floorPct !== null && (
        <p className="ladder-gate">
          <Icon name="octagon-alert" size={15} />
          <span>
            <b>{`${gate.resolved} of ${gate.population} resolved`}</b> — the distribution draws
            at {gate.floorPct}%. A chart at this coverage would be well formed and wrong, so the
            ladder shows what is known and what is outstanding. The footprint figures beside each
            tier are real: they are the population each tier will be drawn from.
          </span>
          {gate.canReview && gate.reviewLink && (
            <Link className="btn sm secondary" href={gate.reviewLink as Route} prefetch={false}>
              <Icon name="pickaxe" size={13} />Research the stage
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

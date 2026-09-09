export type LedgerItem = { value: string | number; label: string; quiet?: boolean };

/** A ruled row of figures. Not cards: four numbers in a row is a ledger line. */
export default function Ledger({ items }: { items: LedgerItem[] }) {
  return (
    <dl className="ledger">
      {items.map((it) => (
        <div className={`item${it.quiet ? " quiet" : ""}`} key={it.label}>
          <dd className="fig-lg" style={{ margin: 0 }}>{it.value}</dd>
          <dt className="k">{it.label}</dt>
        </div>
      ))}
    </dl>
  );
}

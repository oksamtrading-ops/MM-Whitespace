import type { ReactNode } from "react";

export type Fact = { label: string; value: ReactNode; figure?: boolean };

/**
 * The facts about a period, set as a spec line: small label over value, read
 * left to right. It replaces a dot-separated sentence, which nobody can scan.
 */
export default function Facts({ items, className = "" }: { items: Fact[]; className?: string }) {
  return (
    <dl className={`facts ${className}`.trim()}>
      {items.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd className={f.figure ? "fig" : undefined}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

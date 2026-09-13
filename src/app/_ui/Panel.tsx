import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon.tsx";

/**
 * A ruled panel. The container the product did not have.
 *
 * Figures used to sit loose on the page in four different components -- the
 * ledger, the facts row, the queue tiles, "what gets frozen" -- and on a
 * black ground a number with a caption and nothing around it does not read
 * as an object. A panel is a hairline and a header, never a shadowed card:
 * shadow is spent on surface-3, which is dialogs and menus.
 */
export default function Panel({ icon, title, right, children, className = "", bare = false }: {
  icon?: IconName;
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  /** The children are their own layout (a stat row, a table) and need no padding. */
  bare?: boolean;
}) {
  return (
    <section className={`panel ${className}`.trim()} aria-label={title}>
      <header>
        {icon && <Icon name={icon} size={14} />}
        <p className="h">{title}</p>
        {right && <span className="rt">{right}</span>}
      </header>
      {bare ? children : <div className="body">{children}</div>}
    </section>
  );
}

export type Stat = {
  value: ReactNode;
  label: string;
  icon?: IconName;
  /** Secondary: a number about the pipeline rather than about the market. */
  quiet?: boolean;
  href?: Route;
};

/** A ruled row of figures. Equal cells, so none of them orphans. */
export function StatRow({ items }: { items: Stat[] }) {
  return (
    <div className="statrow">
      {items.map((s) => {
        const body = (
          <>
            <div className={`v${s.quiet ? " quiet" : ""}`}>{s.value}</div>
            <div className="l">{s.icon && <Icon name={s.icon} size={12} />}{s.label}</div>
          </>
        );
        return (
          <div key={s.label}>
            {s.href ? <Link href={s.href} prefetch={false}>{body}</Link> : body}
          </div>
        );
      })}
    </div>
  );
}

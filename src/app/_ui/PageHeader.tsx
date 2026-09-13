import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import Icon from "./Icon.tsx";

/**
 * Every route's one header: where you are, how much of it there is, what the
 * period is, and what you can do here.
 *
 * It replaces seventeen improvised arrangements of an h1, a paragraph, a
 * facts row and some inline controls. One 60px band, sticky, so the page's
 * actions stay reachable down a 259-row table. The lede stays in the page
 * body underneath, which is where a sentence belongs.
 */
export default function PageHeader({ title, count, back, meta, actions }: {
  title: string;
  /** Shown as a pill beside the title. A count the page is actually about. */
  count?: number | string;
  /** The way out, for a page that is inside another one. */
  back?: { href: Route; label: string };
  /** The period line: revision, when it was published, whether it was overridden. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="pagehead">
      <div className="where">
        {back && (
          <Link className="btn quiet sm" href={back.href} prefetch={false}>
            <Icon name="arrow-left" size={14} />{back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {count !== undefined && <span className="count">{count}</span>}
      </div>
      {meta && <p className="meta">{meta}</p>}
      {actions && <div className="rt">{actions}</div>}
    </div>
  );
}

import type { CSSProperties, ReactNode } from "react";

/**
 * A ruled section of the dashboard. The query key sits at the right of the
 * heading row in mono: every chart names its query (docs/design/09), and this
 * is where an analyst verifying a figure finds it without a partner noticing.
 */
export default function Section({ id, title, queryKey, caption, index = 0, children }: {
  id: string; title: string; queryKey?: string; caption?: ReactNode; index?: number;
  children: ReactNode;
}) {
  return (
    <section id={id} className="section rise" style={{ "--i": index } as CSSProperties}
             aria-labelledby={`${id}-h`}>
      <div className="head">
        <h2 id={`${id}-h`}>{title}</h2>
        {queryKey && <span className="key" aria-label={`query ${queryKey}`}>{queryKey}</span>}
      </div>
      {caption && <p className="caption">{caption}</p>}
      {children}
    </section>
  );
}

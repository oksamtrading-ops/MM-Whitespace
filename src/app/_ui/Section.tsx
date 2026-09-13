import type { CSSProperties, ReactNode } from "react";
import Icon, { type IconName } from "./Icon.tsx";

/**
 * A ruled section of a page.
 *
 * Two weights. A LEAD section is the argument — the hero, the map, the
 * coverage — and carries an icon on its heading. A plain section is the audit
 * trail behind it and stays quiet. Uniform padding on every section is why
 * the hero and the licence notices used to read the same.
 *
 * The query key sits at the right of the heading row in mono: every chart
 * names its query (docs/design/09). It is there for an analyst verifying a
 * figure, and it hides behind the page's "show working" for everyone else.
 */
export default function Section({ id, title, queryKey, caption, index = 0, icon, lead = false, children }: {
  id: string; title: string; queryKey?: string; caption?: ReactNode; index?: number;
  icon?: IconName; lead?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`section rise${lead ? " lead" : ""}`} style={{ "--i": index } as CSSProperties}
             aria-labelledby={`${id}-h`}>
      <div className="head">
        <h2 id={`${id}-h`}>{icon && <Icon name={icon} size={17} />}{title}</h2>
        {queryKey && <span className="key" aria-label={`query ${queryKey}`}>{queryKey}</span>}
      </div>
      {caption && <p className="caption">{caption}</p>}
      {children}
    </section>
  );
}

import type { ReactNode } from "react";
import type { Route } from "next";
import PageHeader from "./PageHeader.tsx";

/**
 * A route's frame: the one sticky header, then the page's own body.
 *
 * Every screen used to start with a bare h1 and improvise its own
 * arrangement of subtitle, facts and controls, which is most of why objects
 * felt scattered. The header is fixed; what goes under it is the page's.
 */
export default function Page({ title, count, back, meta, actions, children }: {
  title: string;
  count?: number | string;
  back?: { href: Route; label: string };
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} count={count} back={back} meta={meta} actions={actions} />
      <div className="page">{children}</div>
    </>
  );
}

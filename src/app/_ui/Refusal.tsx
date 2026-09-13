import Link from "next/link";
import type { Route } from "next";
import Icon from "./Icon.tsx";

/**
 * A refused, unauthenticated or empty state: a heading, one sentence, one
 * action. The heading strings are asserted by the journeys; the refusal itself
 * is the boundary, so the sentence says what the account is rather than
 * apologising.
 */
export default function Refusal({ title, body, action }: {
  title: string; body: React.ReactNode; action?: { href: Route; label: string };
}) {
  return (
    <div className="page">
      <div className="refusal rise">
        <h1>{title}</h1>
        <p>{body}</p>
        {action && (
          <div className="actions">
            <Link className="btn primary" href={action.href} prefetch={false}>
              {action.label}<Icon name="arrow-right" size={15} />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

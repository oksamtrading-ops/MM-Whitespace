import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon.tsx";

export type Tone = "info" | "ok" | "warn" | "danger";

/**
 * A status callout. Four tones, one reserved icon each.
 *
 * This replaces `.notice`, which carried every state in the application in
 * one shape -- an uppercase word in a colour over a sentence -- about thirty
 * times, with no mark on any of it. The tone here is the icon AND the title
 * together; neither is ever alone, so it survives forced-colours mode and a
 * greyscale print, and a reader who has seen thirty of these can still tell
 * a finished run from a blocked gate at a glance.
 */
const ICON: Record<Tone, IconName> = {
  info: "info",
  ok: "circle-check",
  warn: "triangle-alert",
  danger: "octagon-alert",
};

export default function Callout({ tone = "info", title, children, actions, live, icon, className = "" }: {
  tone?: Tone;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** Announce it when it appears: the result of something the reader just did. */
  live?: boolean;
  /** Override the tone's icon where the subject has its own (a batched run, a frozen period). */
  icon?: IconName;
  className?: string;
}) {
  return (
    <div className={`callout ${tone} ${className}`.trim()} {...(live ? { role: "status" } : {})}>
      <Icon name={icon ?? ICON[tone]} size={17} />
      <div>
        <p className="t">{title}</p>
        {children && <div className="d">{children}</div>}
        {actions && <div className="acts">{actions}</div>}
      </div>
    </div>
  );
}

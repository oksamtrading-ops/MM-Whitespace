"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Icon from "../../_ui/Icon.tsx";

/**
 * "About this revision": the publication record the dashboard is drawn from,
 * one press away in the header. Who published it and when, the line and the
 * as-of date, and, when there is one, why it went through a blocked gate and
 * what an amendment changed, which the publish screen promises is printed on
 * the dashboard's header.
 *
 * A <details>, so it opens without script and its words are in the HTML;
 * script only closes it on Escape or a press outside, as the filters do.
 */
export default function About({ label, warn, children }: { label: string; warn: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const away = (e: MouseEvent) => { if (el.open && !el.contains(e.target as Node)) el.open = false; };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && el.open) {
        el.open = false;
        el.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("mousedown", away);
    el.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); el.removeEventListener("keydown", key); };
  }, []);
  return (
    <details className="db-about" ref={ref}>
      <summary className={`btn sm secondary${warn ? " db-about-warn" : ""}`}>
        <Icon name={warn ? "triangle-alert" : "info"} size={13} /><span className="lbl">{label}</span>
      </summary>
      <div className="db-about-pop">{children}</div>
    </details>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * An in-page index that follows the reader. The current section is the last
 * one whose top has passed a line a third of the way down the viewport --
 * deterministic, and it never lands on a section the reader has not reached.
 * Hidden below 1100px by CSS.
 */
export default function Contents({ items }: { items: Array<{ id: string; label: string }> }) {
  const [current, setCurrent] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const line = window.innerHeight * 0.33;
      let pick = items[0]?.id ?? "";
      for (const it of items) {
        const el = document.getElementById(it.id);
        if (el && el.getBoundingClientRect().top <= line) pick = it.id;
      }
      setCurrent(pick);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [items]);

  return (
    <nav className="contents" aria-label="On this page">
      <p className="k">On this page</p>
      <ol>
        {items.map((it) => (
          <li key={it.id}>
            <a href={`#${it.id}`} aria-current={current === it.id ? "true" : undefined}>{it.label}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

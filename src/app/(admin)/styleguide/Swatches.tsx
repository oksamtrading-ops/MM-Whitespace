"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Token swatches read from the live stylesheet, not from a list that could
 * drift: each swatch paints `var(--name)` and, once mounted, reports what
 * that resolved to in the theme it sits in. The contrast column is computed
 * the same way the build gate computes it.
 */
export function relLum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function toHex(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return rgb;
  return "#" + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export default function Swatches({ tokens, against = "surface" }: { tokens: string[]; against?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const probe = document.createElement("span");
    el.appendChild(probe);
    const out: Record<string, string> = {};
    for (const t of [...tokens, against]) {
      probe.style.color = `var(--${t})`;
      out[t] = toHex(getComputedStyle(probe).color);
    }
    probe.remove();
    setResolved(out);
  }, [tokens, against]);
  const bg = resolved[against];
  return (
    <div className="swatches" ref={ref}>
      {tokens.map((t) => {
        const hex = resolved[t];
        const ratio = hex && bg && /^#[0-9A-F]{6}$/.test(hex) && /^#[0-9A-F]{6}$/.test(bg) ? contrast(hex, bg) : null;
        return (
          <div className="swatch" key={t}>
            <div className="chip-bg" style={{ background: `var(--${t})` }} />
            <div className="meta">
              <b>--{t}</b>
              <code>{hex ?? "…"}</code>
              {ratio !== null && <span className="fig-sm">{ratio.toFixed(2)}:1 on --{against}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

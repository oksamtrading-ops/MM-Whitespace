"use client";

import { useState } from "react";

import { THEME_COOKIE, type Theme } from "./theme.ts";
const THEMES: Array<[Theme, string]> = [["dark", "Dark"], ["light", "Light"], ["system", "System"]];

/**
 * The theme switch. Three words, one pressed. The choice is a cookie so the
 * server renders the next page in it (no flash), and the attribute is set
 * here so this page changes without a round trip. Dark is the product's
 * theme; light is one press away for a partner reading it beside paper.
 */
export default function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const choose = (t: Theme) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = t === "light" ? "#FFFFFF" : t === "dark" ? "#000000"
      : (matchMedia("(prefers-color-scheme: light)").matches ? "#FFFFFF" : "#000000");
  };
  return (
    <div className="theme" role="group" aria-label="Theme">
      {THEMES.map(([t, label]) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => choose(t)}>{label}</button>
      ))}
    </div>
  );
}

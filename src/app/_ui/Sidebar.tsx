"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Icon, { type IconName } from "./Icon.tsx";
import { RAIL_COOKIE, THEME_COOKIE, type Theme } from "./theme.ts";

export type NavItem = { href: Route; label: string; icon: IconName; group: NavGroup };
export type NavGroup = "product" | "period" | "admin";

const GROUPS: Array<[NavGroup, string]> = [
  ["product", "Product"],
  ["period", "Period"],
  ["admin", "Admin"],
];

const THEMES: Array<[Theme, string, IconName]> = [
  ["dark", "Dark", "moon"],
  ["light", "Light", "sun"],
  ["system", "System", "monitor"],
];

/**
 * The left rail.
 *
 * Ten destinations in three groups, because they are three things: the
 * product a partner reads, the period an analyst builds, and the
 * administration behind both. A Viewer sees the first group and the rail is
 * two rows tall.
 *
 * Collapsed state is a cookie, not localStorage, so the server renders the
 * rail at the width the reader chose and it does not jump on first paint.
 * Collapsed, every item keeps its label as its accessible name and shows it
 * in a tooltip on hover and on focus.
 */
export default function Sidebar({ items, collapsed: initial, theme, period, user }: {
  items: NavItem[];
  collapsed: boolean;
  theme: Theme;
  period: { name: string; draft: boolean } | null;
  user: { email: string; role: string } | null;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initial);
  const [themeNow, setThemeNow] = useState<Theme>(theme);

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const toggleRail = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${RAIL_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };

  // One control, cycling. Three segments in a 56px rail is three controls
  // where the reader wanted one, and the label always names both states.
  const nextTheme = THEMES[(THEMES.findIndex(([t]) => t === themeNow) + 1) % THEMES.length];
  const cycleTheme = () => {
    const [t] = nextTheme;
    setThemeNow(t);
    document.documentElement.dataset.theme = t;
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) {
      meta.content = t === "light" ? "#FFFFFF" : t === "dark" ? "#000000"
        : (matchMedia("(prefers-color-scheme: light)").matches ? "#FFFFFF" : "#000000");
    }
  };
  const current = THEMES.find(([t]) => t === themeNow)!;

  return (
    <div className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <Link className="brand" href="/" prefetch={false} translate="no" aria-label="Whitespace, home">
        {collapsed
          ? <span className="stop" aria-hidden="true" />
          : <><span className="name">Whitespace</span><span className="stop" aria-hidden="true" /></>}
      </Link>

      {GROUPS.map(([group, label]) => {
        const inGroup = items.filter((i) => i.group === group);
        if (inGroup.length === 0) return null;
        return (
          <nav key={group} aria-label={label}>
            <p className="grp">{label}</p>
            {inGroup.map((item) => (
              <span className="tip" key={item.href}>
                <Link className="item" href={item.href} prefetch={false}
                      aria-current={isCurrent(item.href) ? "page" : undefined}>
                  <Icon name={item.icon} size={15} {...(collapsed ? { label: item.label } : {})} />
                  {!collapsed && <span className="label">{item.label}</span>}
                </Link>
                {collapsed && <span className="bubble" role="tooltip">{item.label}</span>}
              </span>
            ))}
          </nav>
        );
      })}

      <div className="foot">
        {period && (
          <p className="period" title={`${period.name}${period.draft ? " · draft" : ""}`}>
            <span className={`dot${period.draft ? " draft" : ""}`} aria-hidden="true" />
            {!collapsed && <span className="name">{period.name}</span>}
            {collapsed && <span className="sr-only">{period.name}{period.draft ? ", draft" : ""}</span>}
          </p>
        )}

        <span className="tip">
          <button type="button" className="railbtn" onClick={cycleTheme}
                  aria-label={`Theme: ${current[1].toLowerCase()}. Switch to ${nextTheme[1].toLowerCase()}.`}>
            <Icon name={current[2]} size={15} />
            {!collapsed && <span>{current[1]}</span>}
          </button>
          {collapsed && <span className="bubble" role="tooltip">Theme: {current[1].toLowerCase()}</span>}
        </span>

        <span className="tip">
          <button type="button" className="railbtn" onClick={toggleRail}
                  aria-label={collapsed ? "Expand the navigation" : "Collapse the navigation"}
                  aria-expanded={!collapsed}>
            <Icon name={collapsed ? "panel-left-open" : "panel-left-close"} size={15} />
            {!collapsed && <span>Collapse</span>}
          </button>
          {collapsed && <span className="bubble" role="tooltip">Expand the navigation</span>}
        </span>

        {user
          ? (
            <p className="who" title={`${user.email} · ${user.role}`}>
              <Icon name="circle-user" size={15} />
              {!collapsed && <><span className="email">{user.email}</span><span className="role">{user.role}</span></>}
              {collapsed && <span className="sr-only">{user.email}, {user.role}</span>}
            </p>
          )
          : (
            <span className="tip">
              <Link className="railbtn" href="/signin" prefetch={false} aria-label="Sign in">
                <Icon name="log-in" size={15} />
                {!collapsed && <span>Sign in</span>}
              </Link>
              {collapsed && <span className="bubble" role="tooltip">Sign in</span>}
            </span>
          )}
      </div>
    </div>
  );
}

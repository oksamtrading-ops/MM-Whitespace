"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

export type NavItem = { href: Route; label: string };

/**
 * The layout is a Server Component and cannot know the pathname, so the
 * current-section mark lives here. The links themselves are still gated by
 * role in the layout: this only decorates what it is given.
 */
export default function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(href + "/");
  return (
    <nav className="nav" aria-label="Sections">
      {items.map((item) => (
        <Link key={item.href} href={item.href} prefetch={false}
              aria-current={isCurrent(item.href) ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

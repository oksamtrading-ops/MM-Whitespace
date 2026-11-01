"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DELOITTE, firmLabel, propertyCounts, type Atlas, type AtlasCompany } from "../../../lib/publish/lens.ts";
import Icon from "../../_ui/Icon.tsx";
import { groupOf, nameOf } from "./words.ts";

/**
 * Find: a company by name or ticker, or a place by name, from anywhere on
 * the page (⌘K, Ctrl-K or "/"). A company opens on the globe with its head
 * office joined to every place it holds ground; a place filters the page.
 * Results are ordered by how well they match, then by name -- never by
 * size, which would make a search box a ranking.
 */

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type Hit = { kind: "company"; c: AtlasCompany } | { kind: "place"; key: string; n: number };

export default function Find({ atlas, onClose, onCompany, onPlace }: {
  atlas: Atlas;
  onClose: () => void;
  onCompany: (c: AtlasCompany) => void;
  onPlace: (key: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);

  const places = useMemo(() => propertyCounts(atlas.companies).map((p) => ({ key: p.key, name: fold(nameOf(p.key)), n: p.n })), [atlas]);
  const hits = useMemo((): Hit[] => {
    const f = fold(q.trim());
    if (!f) return [];
    const score = (name: string, ticker: string | null) =>
      ticker && fold(ticker) === f ? 0 : name.startsWith(f) ? 1 : name.includes(` ${f}`) ? 2 : name.includes(f) ? 3 : 9;
    const companies = atlas.companies
      .map((c) => ({ c, s: score(fold(c.name), c.ticker) }))
      .filter((x) => x.s < 9)
      .sort((a, b) => a.s - b.s || a.c.name.localeCompare(b.c.name))
      .slice(0, 8)
      .map((x): Hit => ({ kind: "company", c: x.c }));
    const found = places.filter((p) => p.name.includes(f))
      .sort((a, b) => Number(!a.name.startsWith(f)) - Number(!b.name.startsWith(f)) || a.name.localeCompare(b.name))
      .slice(0, 4)
      .map((p): Hit => ({ kind: "place", key: p.key, n: p.n }));
    return [...companies, ...found];
  }, [q, atlas, places]);

  // Closed before it goes, so the browser hands focus back as a dialog should;
  // the page then moves it to the card the choice opened.
  const choose = (h: Hit | undefined) => {
    if (!h) return;
    dialog.current?.close();
    if (h.kind === "company") onCompany(h.c); else onPlace(h.key);
  };

  return (
    <dialog ref={dialog} className="find" aria-label="Find a company or a place" onClose={onClose}
            onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
      <div className="find-in">
        <Icon name="search" size={16} />
        <input autoFocus type="search" value={q} placeholder="A company, a ticker or a place"
               role="combobox" aria-expanded={hits.length > 0} aria-controls="find-list" aria-autocomplete="list"
               aria-activedescendant={hits.length ? `find-${at}` : undefined}
               onChange={(e) => { setQ(e.target.value); setAt(0); }}
               onKeyDown={(e) => {
                 if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(hits.length - 1, i + 1)); }
                 if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
                 if (e.key === "Enter") { e.preventDefault(); choose(hits[at]); }
               }} />
        <kbd>Esc</kbd>
      </div>
      <ul id="find-list" role="listbox" aria-label="Matches">
        {hits.map((h, i) => (
          <li key={h.kind === "company" ? h.c.id : h.key} id={`find-${i}`} role="option" aria-selected={i === at}
              onMouseEnter={() => setAt(i)} onClick={() => choose(h)}>
            {h.kind === "company" ? (
              <>
                <Icon name="building-2" size={14} />
                <span className="nm">{h.c.name}</span>
                <span className="tk">{[h.c.ticker, h.c.exchange].filter(Boolean).join(" · ")}</span>
                <span className={`au${h.c.auditor === DELOITTE ? " ours" : ""}`}>{firmLabel(h.c.auditor)}</span>
              </>
            ) : (
              <>
                <Icon name="map-pin" size={14} />
                <span className="nm">{nameOf(h.key)}</span>
                <span className="tk">{groupOf(h.key) || "Country"}</span>
                <span className="au">{h.n} with ground here</span>
              </>
            )}
          </li>
        ))}
      </ul>
      {q.trim() && hits.length === 0 && <p className="find-none">Nothing in this period matches &ldquo;{q.trim()}&rdquo;.</p>}
      {!q.trim() && <p className="find-none">A company opens on the globe, joined to its ground. A place filters the page.</p>}
    </dialog>
  );
}

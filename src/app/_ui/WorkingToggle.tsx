"use client";

import { useState } from "react";
import Icon from "./Icon.tsx";

/**
 * "Show working" — the query key beside every section heading.
 *
 * Doc 09 requires every chart to name its query, and an analyst verifying a
 * figure needs it. A partner reading a conclusion does not, so it is on by
 * default for anyone who can review and off for a Viewer, and this puts the
 * choice in their hands either way.
 *
 * It does NOT hide the footings. Those are the signature, and a gated view
 * has to be able to prove itself to whoever is looking.
 */
export default function WorkingToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const toggle = () => {
    const next = !on;
    setOn(next);
    document.body.classList.toggle("working-off", !next);
    document.cookie = `mm_working=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <button type="button" className="btn sm quiet" onClick={toggle} aria-pressed={on}>
      <Icon name="eye" size={13} />{on ? "Hide working" : "Show working"}
    </button>
  );
}

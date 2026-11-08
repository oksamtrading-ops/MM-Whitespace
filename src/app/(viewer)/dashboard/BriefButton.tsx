"use client";

import { useRef, useState } from "react";
import type { Atlas } from "../../../lib/publish/lens.ts";
import Icon from "../../_ui/Icon.tsx";
import Brief from "./Brief.tsx";

/**
 * Brief me: the period as full-screen frames to present from (doc 19 §7),
 * opened from the header. Leaving it hands the keyboard back to this button.
 */
export default function BriefButton({ atlas, periodTitle }: { atlas: Atlas; periodTitle: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button type="button" className="btn sm primary" ref={button} onClick={() => setOpen(true)}>
        <Icon name="play" size={13} /><span className="lbl">Brief me</span>
      </button>
      {open && <Brief atlas={atlas} periodTitle={periodTitle}
                      onClose={() => { setOpen(false); requestAnimationFrame(() => button.current?.focus()); }} />}
    </>
  );
}

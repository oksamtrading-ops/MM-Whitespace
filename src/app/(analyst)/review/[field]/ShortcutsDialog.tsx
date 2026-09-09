"use client";

import { useEffect, useRef } from "react";

const KEYS: Array<[string, string]> = [
  ["↓ ↑", "Move row; the evidence follows"],
  ["Home End", "First or last row"],
  ["A", "Accept"],
  ["O", "Override"],
  ["F", "Flag, with a reason"],
  ["Space", "Show or hide the evidence"],
  ["E", "Open the cited source"],
  ["/", "Find a company"],
  ["⇧A", "Accept the remainder in this column, after confirming"],
  ["⌘Z", "Undo the last decision"],
  ["Esc", "Close; editor → cell"],
];

export default function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby="keys-h" onClose={onClose}>
      <h2 id="keys-h">Keyboard</h2>
      <table>
        <tbody>
          {KEYS.map(([k, a]) => (
            <tr key={k}><td><kbd>{k}</kbd></td><td>{a}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}

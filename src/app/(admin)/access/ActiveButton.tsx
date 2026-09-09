"use client";

import { useFormStatus } from "react-dom";

/** The row's one control, showing that it is working while the action runs. */
export default function ActiveButton({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn quiet${pending ? " pending" : ""}`}
            disabled={disabled || pending} aria-disabled={disabled || pending}>
      {pending ? "Saving…" : label}
    </button>
  );
}

"use client";

import { useFormStatus } from "react-dom";
import Icon from "../../_ui/Icon.tsx";

/**
 * The row's one control, showing that it is working while the action runs.
 *
 * Small, so it fits inside a 36px row rather than hanging below it, and
 * drawn as a danger outline when it removes access -- the only thing in this
 * application that takes something away from somebody.
 */
export default function ActiveButton({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  const removing = label === "Deactivate";
  return (
    <button type="submit" className={`btn sm ${removing ? "danger" : "secondary"}${pending ? " loading" : ""}`}
            disabled={disabled || pending} aria-disabled={disabled || pending}
            aria-busy={pending || undefined}>
      <Icon name={removing ? "user-x" : "circle-check"} size={13} />{label}
    </button>
  );
}

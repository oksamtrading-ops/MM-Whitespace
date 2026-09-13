"use client";

import { useState, type ReactNode } from "react";

/** Re-mounts its children so their entrance choreography plays again. */
export default function Replay({ children, label = "Play" }: { children: ReactNode; label?: string }) {
  const [take, setTake] = useState(0);
  return (
    <>
      <div className="motion">
        <button type="button" className="btn" onClick={() => setTake((t) => t + 1)}>{label}</button>
        <span className="meta">Take {take + 1}. Under reduced motion nothing here moves.</span>
      </div>
      <div key={take}>{children}</div>
    </>
  );
}

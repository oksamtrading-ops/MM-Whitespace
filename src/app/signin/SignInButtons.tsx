"use client";

import { useState } from "react";
import Callout from "../_ui/Callout.tsx";

const ACCOUNTS = [
  { email: "admin@example.invalid", role: "Admin",
    can: "Everything: the dashboard, the review workspace, the access review and the publish override." },
  { email: "analyst@example.invalid", role: "Analyst",
    can: "The review workspace and the dashboard." },
  { email: "viewer@example.invalid", role: "Viewer",
    can: "The published dashboard only." },
];

export default function SignInButtons({ currentEmail = null }: { currentEmail?: string | null }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function signIn(email: string) {
    setPending(email);
    setMessage(null);
    try {
      const res = await fetch("/api/dev/signin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // "/" sends each role to the screen it starts on.
      if (res.ok) { window.location.href = "/"; return; }
      const body = await res.json().catch(() => ({}));
      setMessage(body.error ?? "Sign-in failed. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <div className="roles">
        {ACCOUNTS.map((a) => {
          const current = a.email === currentEmail;
          return (
            <button type="button" className="role" key={a.email}
                    onClick={() => signIn(a.email)} disabled={pending !== null || current}>
              <span className="name">
                {a.role}
                {current && <span className="pill quiet">current</span>}
              </span>
              <span className="can">{a.can}</span>
              <span className="chev" aria-hidden="true">{pending === a.email ? "…" : current ? "" : "→"}</span>
            </button>
          );
        })}
      </div>
      <div role="status" aria-live="polite">
        {message && <Callout tone="danger" title="Sign-in failed" className="rise">{message}</Callout>}
      </div>
    </>
  );
}

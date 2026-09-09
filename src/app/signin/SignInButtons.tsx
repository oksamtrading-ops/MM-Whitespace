"use client";

import { useState } from "react";

const ACCOUNTS = [
  { email: "admin@example.invalid", role: "Admin",
    can: "Everything: the dashboard, the review workspace, the access review and the publish override." },
  { email: "analyst@example.invalid", role: "Analyst",
    can: "The review workspace and the dashboard." },
  { email: "viewer@example.invalid", role: "Viewer",
    can: "The published dashboard only." },
];

export default function SignInButtons() {
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
        {ACCOUNTS.map((a) => (
          <button type="button" className="role" key={a.email}
                  onClick={() => signIn(a.email)} disabled={pending !== null}>
            <span className="name">{a.role}</span>
            <span className="can">{a.can}</span>
            <span className="chev" aria-hidden="true">{pending === a.email ? "…" : "→"}</span>
          </button>
        ))}
      </div>
      <div role="status" aria-live="polite">
        {message && <div className="notice alert" style={{ marginTop: 20 }}>{message}</div>}
      </div>
    </>
  );
}

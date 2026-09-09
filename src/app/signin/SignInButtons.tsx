"use client";

import { useState } from "react";

const ACCOUNTS = [
  { email: "admin@example.invalid", role: "Admin",
    can: "Everything, plus the access review and the publish override." },
  { email: "analyst@example.invalid", role: "Analyst",
    can: "The review workspace and the dashboard. Refused the access review." },
  { email: "viewer@example.invalid", role: "Viewer",
    can: "The dashboard only. Refused the review workspace." },
];

export default function SignInButtons() {
  const [message, setMessage] = useState<string | null>(null);

  async function signIn(email: string) {
    const res = await fetch("/api/dev/signin", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (res.ok) { window.location.href = "/dashboard"; return; }
    const body = await res.json().catch(() => ({}));
    setMessage(body.error ?? "sign-in failed");
  }

  return (
    <>
      <div className="cards" style={{ alignItems: "stretch" }}>
        {ACCOUNTS.map((a) => (
          <div className="card" key={a.email} style={{ maxWidth: 240 }}>
            <div className="k">{a.role}</div>
            <p className="sub" style={{ margin: ".4rem 0 .75rem", fontSize: ".8rem" }}>
              {a.can}
            </p>
            <button type="button" className="linkbtn" onClick={() => signIn(a.email)}>
              Sign in as {a.role}
            </button>
          </div>
        ))}
      </div>
      {message && <div className="banner" role="status">{message}</div>}
      <p className="sub">
        Try signing in as a Viewer and then opening <code>/review</code> — the refusal is
        the boundary, not the missing link in the sidebar.
      </p>
    </>
  );
}

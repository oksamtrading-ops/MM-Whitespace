"use client";

/**
 * Something threw while rendering. Say what happened in plain terms and give
 * one way forward; the detail goes to the console, not the partner.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="refusal">
      <h1>This page could not be drawn</h1>
      <p>
        The data behind it is intact; the page failed while rendering.
        {error.digest && <> Reference <code>{error.digest}</code>.</>}
      </p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => reset()}>Try again</button>
        <a className="btn quiet" href="/dashboard">Go to the dashboard</a>
      </div>
    </div>
  );
}

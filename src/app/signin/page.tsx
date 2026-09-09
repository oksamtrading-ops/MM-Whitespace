import SignInButtons from "./SignInButtons.tsx";

export const dynamic = "force-dynamic";

/**
 * Development sign-in.
 *
 * NOT magic-link authentication. It exists so the application can be opened in
 * a browser before a Supabase project does, and the claim source it writes for
 * refuses to run outside development. In production this page renders nothing
 * but a note saying so.
 */
export default async function SignIn() {
  if (process.env.NODE_ENV === "production") {
    return (
      <>
        <h1>Sign in</h1>
        <div className="empty">
          <p>This build has no identity provider configured yet. Magic-link sign-in,
             and then Deloitte SSO, plug in at the claim source.</p>
        </div>
      </>
    );
  }
  return (
    <>
      <h1>Sign in</h1>
      <p className="sub">
        Development sign-in only — not magic link, and it refuses to run outside
        development. The application is invite-only, so these three addresses exist in
        <code> app_users</code> and nothing else will be accepted.
      </p>
      <SignInButtons />
    </>
  );
}

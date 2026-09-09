import type { Metadata } from "next";
import Refusal from "../_ui/Refusal.tsx";
import SignInButtons from "./SignInButtons.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

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
      <Refusal title="Sign in"
               body="This build has no identity provider configured yet. Magic-link sign-in, and then Deloitte SSO, plug in at the claim source." />
    );
  }
  return (
    <div className="signin rise">
      <h1 translate="no">Whitespace<span className="stop" aria-hidden="true" /></h1>
      <p className="lede">
        Which Canadian miners Deloitte does not audit yet, and the evidence for saying so.
      </p>
      <SignInButtons />
      <p className="foot">
        Development sign-in. These three accounts exist in <code>app_users</code>; nothing else
        is accepted, and this page refuses to run outside development.
      </p>
    </div>
  );
}

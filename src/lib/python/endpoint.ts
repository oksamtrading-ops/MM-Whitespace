/**
 * Where this application's Python functions answer.
 *
 * Two of them: the upload parser (`/api/parse`) and the workbook builder
 * (`/api/workbook`). Locally there is no function host, so the caller runs
 * `python3` instead and this returns null. On Vercel, whose Node functions
 * have no Python, both are HTTP calls the application makes to itself.
 *
 * THE PATHS MUST NOT COLLIDE WITH A ROUTE HANDLER. A file in api/ and a
 * Next.js route of the same name are one URL, and the Python function wins:
 * the builder first shipped as api/export.py beside the app's own
 * /api/export route, so every download came back "unauthorized" from the
 * function that never saw the request the person made. endpoint.test.ts
 * fails the build if any api/*.py ever shares a name with a route again.
 */
export type PythonEndpoint = { url: string; headers: Record<string, string> };

export class NotConfigured extends Error {}

/** The function's own path, which is never a path the application routes. */
export const PYTHON_ROUTES = { parse: "parse", export: "workbook" } as const;

export function pythonEndpoint(
  route: keyof typeof PYTHON_ROUTES,
  env: Record<string, string | undefined> = process.env,
): PythonEndpoint | null {
  const bypass: Record<string, string> = env.VERCEL_AUTOMATION_BYPASS_SECRET
    ? { "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET }
    : {};
  const override = route === "parse" ? env.MM_PARSE_URL : env.MM_EXPORT_URL;
  if (override) return { url: override, headers: bypass };
  if (!env.VERCEL) return null;
  // The production domain, not the deployment's own URL: deployment URLs sit
  // behind Vercel's login under Standard Protection, and this request comes
  // from a server that has no browser session to present.
  const host = env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL
    ? env.VERCEL_PROJECT_PRODUCTION_URL
    : env.VERCEL_URL;
  if (!host) throw new NotConfigured(`The ${route} function is not configured on this deployment.`);
  return { url: `https://${host}/api/${PYTHON_ROUTES[route]}`, headers: bypass };
}

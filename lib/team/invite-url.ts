function trimTrailingSlash(input: string): string {
  return input.replace(/\/+$/, "");
}

function inferOriginFromRequest(req: Request): string | null {
  const proto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (proto && host) return `${proto}://${host}`;
  try {
    return new URL(req.url).origin;
  } catch {
    return null;
  }
}

/**
 * Canonical app origin for redirects and emailed links.
 *
 * In production, prefer `NEXT_PUBLIC_APP_URL` so request Host / X-Forwarded-* headers
 * cannot redirect users to an attacker-controlled origin.
 *
 * In development / tests, fall back to the incoming request origin when helpful.
 */
export function getAppBaseUrl(req?: Request): string {
  const envBase = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && envBase) {
    return trimTrailingSlash(envBase);
  }
  if (req) {
    const inferred = inferOriginFromRequest(req);
    if (inferred) return trimTrailingSlash(inferred);
  }
  if (envBase) return trimTrailingSlash(envBase);
  return "http://localhost:3000";
}

export function buildTeamInviteUrl(token: string, req?: Request): string {
  const base = getAppBaseUrl(req);
  return `${base}/dashboard/team/join?token=${encodeURIComponent(token)}`;
}

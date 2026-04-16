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

export function getAppBaseUrl(req?: Request): string {
  const envBase = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envBase) return trimTrailingSlash(envBase);
  if (req) {
    const inferred = inferOriginFromRequest(req);
    if (inferred) return trimTrailingSlash(inferred);
  }
  return "http://localhost:3000";
}

export function buildTeamInviteUrl(token: string, req?: Request): string {
  const base = getAppBaseUrl(req);
  return `${base}/dashboard/team/join?token=${encodeURIComponent(token)}`;
}

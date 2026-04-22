/**
 * Structural validation for successful `GET /api/health` JSON (200).
 * Use in tests and uptime monitors so response shape regressions are caught early.
 */
export function isCompleteHealthCheckResponse(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  if (typeof o.ok !== "boolean") return false;
  if (typeof o.checkedAt !== "string") return false;
  if (o.service !== "zephyr-markets") return false;

  if (!o.checks || typeof o.checks !== "object") return false;
  const c = o.checks as Record<string, unknown>;
  if (typeof c.env !== "boolean") return false;
  for (const key of ["supabase", "portfolioFeeds", "portfolioTables"] as const) {
    if (typeof c[key] !== "string") return false;
  }

  if (!o.portfolioDataPlane || typeof o.portfolioDataPlane !== "object") {
    return false;
  }
  const p = o.portfolioDataPlane as Record<string, unknown>;
  for (const key of ["portfolioPnl", "positions"] as const) {
    const v = p[key];
    if (v !== "ok" && v !== "error" && v !== "unknown") return false;
  }

  if (!o.feedHealth || typeof o.feedHealth !== "object") return false;
  const f = o.feedHealth as Record<string, unknown>;
  for (const key of [
    "powerAgeHours",
    "gasAgeHours",
    "fxAgeDays",
    "carbonAgeDays",
  ] as const) {
    const v = f[key];
    if (v != null && typeof v !== "number") return false;
  }
  if (!Array.isArray(f.warnings)) return false;
  if (!f.warnings.every((w) => typeof w === "string")) return false;

  return true;
}

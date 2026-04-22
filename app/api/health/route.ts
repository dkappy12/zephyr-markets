import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function parseUtcMs(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function ageHoursSince(value: unknown): number | null {
  const ms = parseUtcMs(value);
  if (ms == null) return null;
  return (Date.now() - ms) / (1000 * 60 * 60);
}

function ageDaysSinceDateOnly(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return null;
  return (Date.now() - ms) / (1000 * 60 * 60 * 24);
}

export async function GET() {
  const now = new Date().toISOString();
  const base = {
    ok: true,
    checkedAt: now,
    service: "zephyr-markets",
    checks: {
      env: true,
      supabase: "unknown" as "ok" | "error" | "unknown",
      portfolioFeeds: "unknown" as "ok" | "warn" | "error" | "unknown",
      portfolioTables: "unknown" as "ok" | "error" | "unknown",
    },
    portfolioDataPlane: {
      portfolioPnl: "unknown" as "ok" | "error" | "unknown",
      positions: "unknown" as "ok" | "error" | "unknown",
    },
    feedHealth: {
      powerAgeHours: null as number | null,
      gasAgeHours: null as number | null,
      fxAgeDays: null as number | null,
      carbonAgeDays: null as number | null,
      warnings: [] as string[],
    },
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { ...base, ok: false, checks: { ...base.checks, env: false } },
      { status: 500 },
    );
  }

  try {
    const admin = createAdminClient(url, serviceRoleKey);
    // Verify DB/auth reachability without exposing business data.
    const [
      authPing,
      powerLatest,
      gasLatest,
      fxLatest,
      carbonLatest,
      portfolioPnlPing,
      positionsPing,
    ] = await Promise.all([
      admin.from("auth_audit_log").select("id").limit(1),
      admin
        .from("market_prices")
        .select("price_date")
        .or("market.eq.N2EX,market.eq.APX")
        .order("price_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("gas_prices")
        .select("price_time")
        .in("hub", ["TTF", "NBP"])
        .order("price_time", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("fx_rates")
        .select("rate_date")
        .eq("base", "EUR")
        .eq("quote", "GBP")
        .order("rate_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("carbon_prices")
        .select("price_date")
        .in("hub", ["UKA", "EUA"])
        .order("price_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from("portfolio_pnl").select("user_id").limit(1),
      admin.from("positions").select("id").limit(1),
    ]);

    if (authPing.error) {
      return NextResponse.json(
        {
          ...base,
          ok: false,
          checks: { ...base.checks, supabase: "error" },
        },
        { status: 500 },
      );
    }
    const powerAgeHours = ageHoursSince(
      powerLatest.data?.price_date != null
        ? `${powerLatest.data.price_date}T23:59:59.000Z`
        : null,
    );
    const gasAgeHours = ageHoursSince(gasLatest.data?.price_time ?? null);
    const fxAgeDays = ageDaysSinceDateOnly(fxLatest.data?.rate_date ?? null);
    const carbonAgeDays = ageDaysSinceDateOnly(carbonLatest.data?.price_date ?? null);

    const warnings: string[] = [];
    let hasWarn = false;
    let hasError = false;
    const markWarn = (w: string) => {
      warnings.push(w);
      hasWarn = true;
    };
    const markError = (w: string) => {
      warnings.push(w);
      hasError = true;
    };

    if (powerAgeHours == null) markError("No GB power rows found (N2EX/APX).");
    else if (powerAgeHours > 48)
      markError(`GB power feed stale: ${powerAgeHours.toFixed(1)}h old.`);
    else if (powerAgeHours > 30)
      markWarn(`GB power feed aging: ${powerAgeHours.toFixed(1)}h old.`);

    if (gasAgeHours == null) markError("No gas rows found (TTF/NBP).");
    else if (gasAgeHours > 48)
      markError(`Gas feed stale: ${gasAgeHours.toFixed(1)}h old.`);
    else if (gasAgeHours > 30)
      markWarn(`Gas feed aging: ${gasAgeHours.toFixed(1)}h old.`);

    if (fxAgeDays == null) markWarn("No EUR/GBP fx_rates rows found.");
    else if (fxAgeDays > 5)
      markError(`FX feed stale: ${fxAgeDays.toFixed(1)}d old.`);
    else if (fxAgeDays > 3)
      markWarn(`FX feed aging: ${fxAgeDays.toFixed(1)}d old.`);

    if (carbonAgeDays == null) markWarn("No carbon rows found (UKA/EUA).");
    else if (carbonAgeDays > 7)
      markError(`Carbon feed stale: ${carbonAgeDays.toFixed(1)}d old.`);
    else if (carbonAgeDays > 4)
      markWarn(`Carbon feed aging: ${carbonAgeDays.toFixed(1)}d old.`);

    const portfolioPnlOk = !portfolioPnlPing.error;
    const positionsOk = !positionsPing.error;
    if (!portfolioPnlOk) {
      markError(
        `portfolio_pnl table unreachable: ${portfolioPnlPing.error?.message ?? "unknown"}.`,
      );
    }
    if (!positionsOk) {
      markError(
        `positions table unreachable: ${positionsPing.error?.message ?? "unknown"}.`,
      );
    }

    const feedStatus: "ok" | "warn" | "error" = hasError
      ? "error"
      : hasWarn
        ? "warn"
        : "ok";

    const tablesStatus: "ok" | "error" =
      portfolioPnlOk && positionsOk ? "ok" : "error";

    return NextResponse.json({
      ...base,
      ok: !hasError && portfolioPnlOk && positionsOk,
      checks: {
        ...base.checks,
        supabase: "ok",
        portfolioFeeds: feedStatus,
        portfolioTables: tablesStatus,
      },
      portfolioDataPlane: {
        portfolioPnl: portfolioPnlOk ? "ok" : "error",
        positions: positionsOk ? "ok" : "error",
      },
      feedHealth: {
        powerAgeHours,
        gasAgeHours,
        fxAgeDays,
        carbonAgeDays,
        warnings,
      },
    });
  } catch {
    return NextResponse.json(
      {
        ...base,
        ok: false,
        checks: { ...base.checks, supabase: "error" },
      },
      { status: 500 },
    );
  }
}

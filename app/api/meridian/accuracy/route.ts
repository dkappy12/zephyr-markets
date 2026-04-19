import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const REGIME_KEYS = ["gas-dominated", "transitional", "renewable"] as const;
const REGIME_LABELS: Record<(typeof REGIME_KEYS)[number], string> = {
  "gas-dominated": "Gas-dominated",
  transitional: "Transitional",
  renewable: "Renewable",
};

function round2(n: number): number {
  return Number(n.toFixed(2));
}

export async function GET() {
  try {
    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("premium_predictions")
      .select("regime, absolute_error_gbp_mwh, signed_error_gbp_mwh, target_date")
      .eq("is_filled", true)
      .limit(1000);

    if (error) {
      throw new Error(error.message);
    }

    const list = rows ?? [];
    const filled_count = list.length;

    const absVals = list
      .map((r) => {
        const v = (r as Record<string, unknown>).absolute_error_gbp_mwh;
        return typeof v === "number" ? v : v != null ? Number(v) : NaN;
      })
      .filter((x) => Number.isFinite(x));

    const signedVals = list
      .map((r) => {
        const v = (r as Record<string, unknown>).signed_error_gbp_mwh;
        return typeof v === "number" ? v : v != null ? Number(v) : NaN;
      })
      .filter((x) => Number.isFinite(x));

    const overall_mae =
      absVals.length > 0
        ? round2(
            absVals.reduce((s, x) => s + Math.abs(x), 0) / absVals.length,
          )
        : 0;

    const overall_bias =
      signedVals.length > 0
        ? round2(
            signedVals.reduce((s, x) => s + x, 0) / signedVals.length,
          )
        : 0;

    const daySet = new Set<string>();
    for (const r of list) {
      const td = (r as Record<string, unknown>).target_date;
      if (td == null) continue;
      const s = String(td);
      daySet.add(s.length >= 10 ? s.slice(0, 10) : s);
    }
    const days_of_data = daySet.size;

    const regime_stats = REGIME_KEYS.map((key) => {
      const regimeRows = list.filter(
        (r) => String((r as Record<string, unknown>).regime) === key,
      );
      const errs = regimeRows
        .map((r) => {
          const v = (r as Record<string, unknown>).absolute_error_gbp_mwh;
          return typeof v === "number" ? v : v != null ? Number(v) : NaN;
        })
        .filter((x) => Number.isFinite(x));
      const n = errs.length;
      const mae =
        n > 0
          ? round2(errs.reduce((s, x) => s + Math.abs(x), 0) / n)
          : 0;
      return { regime: REGIME_LABELS[key], mae, n };
    });

    return NextResponse.json({
      overall_mae,
      overall_bias,
      filled_count,
      days_of_data,
      regime_stats,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load accuracy stats" },
      { status: 500 },
    );
  }
}

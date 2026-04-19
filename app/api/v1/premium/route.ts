import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api/require-api-key";
import { createAdminClient } from "@/lib/supabase/admin";

function toIsoString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export async function GET(request: Request) {
  try {
    const auth = await requireApiKey(request);
    if (auth.response) return auth.response;

    const admin = createAdminClient();
    const { data: row, error } = await admin
      .from("physical_premium")
      .select(
        "normalised_score, direction, implied_price_gbp_mwh, market_price_gbp_mwh, srmc_gbp_mwh, wind_gw, solar_gw, residual_demand_gw, regime, model_version, calculated_at",
      )
      .order("calculated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const r = row as Record<string, unknown>;

    return NextResponse.json({
      data: {
        premium_score: Number(r.normalised_score),
        direction: String(r.direction ?? ""),
        implied_price_gbp_mwh: Number(r.implied_price_gbp_mwh),
        market_price_gbp_mwh: Number(r.market_price_gbp_mwh),
        srmc_gbp_mwh: Number(r.srmc_gbp_mwh),
        wind_gw: Number(r.wind_gw),
        solar_gw: Number(r.solar_gw),
        residual_demand_gw: Number(r.residual_demand_gw),
        regime: String(r.regime ?? ""),
        calculated_at: toIsoString(r.calculated_at),
      },
      meta: {
        model_version: String(r.model_version ?? ""),
        generated_at: new Date().toISOString(),
        endpoint: "/api/v1/premium",
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load premium data" },
      { status: 500 },
    );
  }
}

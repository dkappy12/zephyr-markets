import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if (auth.response) return auth.response;
  const user = auth.user!;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const date =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date().toISOString().slice(0, 10);
  const snapshotHash =
    typeof body.snapshot_hash === "string" ? body.snapshot_hash : "";

  if (!snapshotHash) {
    return NextResponse.json(
      { code: "INVALID_PAYLOAD", error: "snapshot_hash is required." },
      { status: 400 },
    );
  }

  const totalPnl =
    typeof body.total_pnl === "number" && Number.isFinite(body.total_pnl)
      ? body.total_pnl
      : 0;
  const asNum = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  const attributionJson =
    body.attribution_json && typeof body.attribution_json === "object"
      ? (body.attribution_json as Record<string, unknown>)
      : {};
  attributionJson.snapshot_hash = snapshotHash;

  const positionsSnapshot = Array.isArray(body.positions_snapshot)
    ? body.positions_snapshot
    : [];

  const row = {
    user_id: user.id,
    date,
    total_pnl: totalPnl,
    wind_attribution_gbp: asNum(body.wind_attribution_gbp),
    gas_attribution_gbp: asNum(body.gas_attribution_gbp),
    remit_attribution_gbp: asNum(body.remit_attribution_gbp),
    residual_gbp: asNum(body.residual_gbp),
    carbon_attribution_gbp: asNum(body.carbon_attribution_gbp),
    primary_driver:
      typeof body.primary_driver === "string" ? body.primary_driver : "unknown",
    attribution_json: attributionJson,
    positions_snapshot: positionsSnapshot,
  };

  const { error } = await supabase
    .from("portfolio_pnl")
    .upsert(row, { onConflict: "user_id,date" });
  if (error) {
    return NextResponse.json(
      { code: "SNAPSHOT_FAILED", error: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

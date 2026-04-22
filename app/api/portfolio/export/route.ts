import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] ?? {});
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes('"') || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  const out = [headers.join(",")];
  for (const row of rows) {
    out.push(headers.map((h) => escape(row[h])).join(","));
  }
  return out.join("\n");
}

function parseExportType(
  searchParams: URLSearchParams,
): "positions" | "pnl" | "signals" | null {
  const raw = searchParams.get("type");
  const t = raw === null || raw === "" ? "positions" : raw;
  if (t === "positions" || t === "pnl" || t === "signals") return t;
  return null;
}

export async function GET(request: Request) {
  try {
    const csrf = assertSameOrigin(request);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase, { requireVerifiedEmail: true });
    if (auth.response) return auth.response;
    const user = auth.user!;
    const entitlement = await requireEntitlement(supabase, user.id, {
      feature: "apiAccess",
      minimumTier: "team",
    });
    if (entitlement.response) return entitlement.response;

    const exportType = parseExportType(new URL(request.url).searchParams);
    if (!exportType) {
      return NextResponse.json(
        { error: "Invalid type. Use positions (default), pnl, or signals." },
        { status: 400 },
      );
    }

    let rows: Record<string, unknown>[] = [];
    let filename: string;

    if (exportType === "positions") {
      const { data, error } = await supabase
        .from("positions")
        .select(
          "instrument, market, direction, size, unit, trade_price, tenor",
        )
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
      rows = (data ?? []) as Record<string, unknown>[];
      filename = "positions-export.csv";
    } else if (exportType === "pnl") {
      const { data, error } = await supabase
        .from("portfolio_pnl")
        .select(
          "date, total_pnl, wind_attribution_gbp, gas_attribution_gbp, remit_attribution_gbp, residual_gbp, primary_driver",
        )
        .eq("user_id", user.id)
        .order("date", { ascending: false });
      if (error) throw new Error(error.message);
      rows = (data ?? []) as Record<string, unknown>[];
      filename = "pnl-history-export.csv";
    } else {
      const since = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data, error } = await supabase
        .from("signals")
        .select(
          "title, description, direction, confidence, source, created_at",
        )
        .eq("type", "remit")
        .gte("created_at", since)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      rows = (data ?? []) as Record<string, unknown>[];
      filename = "signals-export.csv";
    }

    const csv = toCsv(rows);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Export failed" },
      { status: 500 },
    );
  }
}

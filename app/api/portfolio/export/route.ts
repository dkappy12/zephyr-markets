import { NextResponse } from "next/server";
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

export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase, { requireVerifiedEmail: true });
    if (auth.response) return auth.response;
    const user = auth.user!;
    const entitlement = await requireEntitlement(supabase, user.id, {
      feature: "apiAccess",
      minimumTier: "team",
    });
    if (entitlement.response) return entitlement.response;

    const { data, error } = await supabase
      .from("positions")
      .select("instrument, market, direction, size, unit, trade_price, tenor, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    const csv = toCsv((data ?? []) as Record<string, unknown>[]);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="positions-export.csv"',
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Export failed" },
      { status: 500 },
    );
  }
}

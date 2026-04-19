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
    const { data: rows, error } = await admin
      .from("storage_levels")
      .select("location, full_pct, report_date")
      .order("report_date", { ascending: false })
      .limit(500);

    if (error) {
      throw new Error(error.message);
    }

    const seen = new Set<string>();
    const latest: Array<{
      location: string;
      full_pct: number;
      report_date: string;
    }> = [];

    for (const row of rows ?? []) {
      const r = row as Record<string, unknown>;
      const loc = String(r.location ?? "");
      if (loc === "" || seen.has(loc)) continue;
      seen.add(loc);
      const pct = r.full_pct;
      const full_pct =
        typeof pct === "number" && Number.isFinite(pct)
          ? pct
          : pct != null && Number.isFinite(Number(pct))
            ? Number(pct)
            : 0;
      latest.push({
        location: loc,
        full_pct,
        report_date: toIsoString(r.report_date),
      });
    }

    return NextResponse.json({
      data: latest,
      meta: {
        source: "GIE AGSI",
        generated_at: new Date().toISOString(),
        endpoint: "/api/v1/storage",
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load storage data" },
      { status: 500 },
    );
  }
}

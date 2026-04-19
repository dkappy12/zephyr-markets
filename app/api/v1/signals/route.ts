import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api/require-api-key";
import { createAdminClient } from "@/lib/supabase/admin";

function parseLimit(request: Request): number {
  const raw = new URL(request.url).searchParams.get("limit");
  if (raw === null || raw === "") return 10;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return 10;
  return Math.min(50, Math.max(1, n));
}

export async function GET(request: Request) {
  try {
    const auth = await requireApiKey(request);
    if (auth.response) return auth.response;

    const limit = parseLimit(request);
    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("signals")
      .select(
        "id, type, title, description, direction, source, confidence, quality_score, created_at, remit_message_id",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    const data = rows ?? [];

    return NextResponse.json({
      data,
      meta: {
        count: data.length,
        generated_at: new Date().toISOString(),
        endpoint: "/api/v1/signals",
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load signals" },
      { status: 500 },
    );
  }
}

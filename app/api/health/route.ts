import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET() {
  const now = new Date().toISOString();
  const base = {
    ok: true,
    checkedAt: now,
    service: "zephyr-markets",
    checks: {
      env: true,
      supabase: "unknown" as "ok" | "error" | "unknown",
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
    // Lightweight read to verify DB + auth are reachable without exposing data.
    const { error } = await admin
      .from("auth_audit_log")
      .select("id")
      .limit(1);
    if (error) {
      return NextResponse.json(
        {
          ...base,
          ok: false,
          checks: { ...base.checks, supabase: "error" },
        },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ...base,
      checks: { ...base.checks, supabase: "ok" },
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

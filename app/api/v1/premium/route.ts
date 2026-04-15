import { NextResponse } from "next/server";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;
    const entitlement = await requireEntitlement(supabase, user.id, {
      feature: "apiAccess",
      minimumTier: "team",
    });
    if (entitlement.response) return entitlement.response;

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      metric: "physical_premium_score",
      value: null,
      note: "Team API surface scaffold. Data payloads are being expanded.",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load premium API data" },
      { status: 500 },
    );
  }
}

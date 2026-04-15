import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";
import { createClient } from "@/lib/supabase/server";

const MAX_HISTORY_DAYS_BY_TIER = {
  free: 7,
  pro: 183,
  team: 730,
  enterprise: 3650,
} as const;

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const state = await getEffectiveBillingState(supabase, auth.user!.id);
    const url = new URL(req.url);
    const requestedDays = Number(url.searchParams.get("days") ?? "30");
    const safeRequestedDays =
      Number.isFinite(requestedDays) && requestedDays > 0 ? Math.floor(requestedDays) : 30;
    const maxDays = MAX_HISTORY_DAYS_BY_TIER[state.effectiveTier];
    const appliedDays = Math.min(maxDays, safeRequestedDays);
    return NextResponse.json({
      tier: state.effectiveTier,
      maxDays,
      requestedDays: safeRequestedDays,
      appliedDays,
      note: "Signal history window guard is enforced; data feed endpoint expansion is in progress.",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load signal history" },
      { status: 500 },
    );
  }
}

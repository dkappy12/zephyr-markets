import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";
import { createClient } from "@/lib/supabase/server";

function coveredMarkets(markets: "gb_nbp_only" | "five_markets" | "all_markets") {
  if (markets === "gb_nbp_only") {
    return ["GB Power", "NBP"];
  }
  if (markets === "five_markets") {
    return ["GB Power", "NBP", "TTF", "EUA", "UKA"];
  }
  return ["GB Power", "NBP", "TTF", "EUA", "UKA", "EU Gas Storage", "Weather"];
}

export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const state = await getEffectiveBillingState(supabase, auth.user!.id);
    return NextResponse.json({
      tier: state.effectiveTier,
      marketsScope: state.entitlements.markets,
      coveredMarkets: coveredMarkets(state.entitlements.markets),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load market coverage" },
      { status: 500 },
    );
  }
}

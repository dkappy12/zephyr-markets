import { NextResponse } from "next/server";
import type { TierCode, TierEntitlement } from "@/lib/billing/entitlements";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";

type BooleanEntitlementKey = {
  [K in keyof TierEntitlement]: TierEntitlement[K] extends boolean ? K : never;
}[keyof TierEntitlement];

type EntitlementClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

type RequireEntitlementOptions = {
  feature?: BooleanEntitlementKey;
  minimumTier?: Exclude<TierCode, "free">;
};

const TIER_RANK: Record<TierCode, number> = {
  free: 0,
  pro: 1,
  team: 2,
  enterprise: 3,
};

export async function requireEntitlement(
  supabase: unknown,
  userId: string,
  options: RequireEntitlementOptions = {},
) {
  const state = await getEffectiveBillingState(supabase as EntitlementClient, userId);

  if (options.feature && !state.entitlements[options.feature]) {
    return {
      state,
      response: NextResponse.json(
        {
          code: "PLAN_REQUIRED",
          error: "This feature requires a paid plan.",
          requiredFeature: options.feature,
          currentTier: state.effectiveTier,
        },
        { status: 403 },
      ),
    };
  }

  if (
    options.minimumTier &&
    TIER_RANK[state.effectiveTier] < TIER_RANK[options.minimumTier]
  ) {
    return {
      state,
      response: NextResponse.json(
        {
          code: "PLAN_REQUIRED",
          error: `This feature requires the ${options.minimumTier} plan or higher.`,
          requiredTier: options.minimumTier,
          currentTier: state.effectiveTier,
        },
        { status: 403 },
      ),
    };
  }

  return { state, response: null };
}

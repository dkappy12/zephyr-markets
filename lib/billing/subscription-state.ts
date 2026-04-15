import type { TierCode, TierEntitlement } from "@/lib/billing/entitlements";
import { TIER_ENTITLEMENTS } from "@/lib/billing/entitlements";

type SubscriptionRow = {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  tier: string;
  interval: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

type SubscriptionStateClient = {
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

export type BillingInterval = "monthly" | "annual";

export type EffectiveBillingState = {
  effectiveTier: TierCode;
  entitlements: TierEntitlement;
  status: string;
  interval: BillingInterval | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  isPaid: boolean;
};

const PAID_STATUSES = new Set(["active", "trialing"]);

function normalizeTier(value: string | null | undefined): TierCode {
  if (value === "pro" || value === "team" || value === "enterprise") {
    return value;
  }
  return "free";
}

function normalizeInterval(value: string | null | undefined): BillingInterval | null {
  if (value === "monthly" || value === "annual") return value;
  return null;
}

export function isPaidSubscriptionStatus(status: string | null | undefined): boolean {
  return PAID_STATUSES.has(String(status ?? "").toLowerCase());
}

export async function getEffectiveBillingState(
  supabase: unknown,
  userId: string,
): Promise<EffectiveBillingState> {
  const client = supabase as SubscriptionStateClient;
  const queryResult = await client
    .from("subscriptions")
    .select(
      "user_id, stripe_customer_id, stripe_subscription_id, tier, interval, status, current_period_end, cancel_at_period_end",
    )
    .eq("user_id", userId)
    .maybeSingle();
  const data = queryResult.data as SubscriptionRow | null;
  const error = queryResult.error;

  if (error) {
    throw new Error(error.message ?? "Failed to load subscription state");
  }

  const status = data?.status ?? "none";
  const paid = isPaidSubscriptionStatus(status);
  const paidTier = normalizeTier(data?.tier);
  const effectiveTier: TierCode = paid ? paidTier : "free";

  return {
    effectiveTier,
    entitlements: TIER_ENTITLEMENTS[effectiveTier],
    status,
    interval: normalizeInterval(data?.interval),
    currentPeriodEnd: data?.current_period_end ?? null,
    cancelAtPeriodEnd: data?.cancel_at_period_end ?? false,
    stripeCustomerId: data?.stripe_customer_id ?? null,
    stripeSubscriptionId: data?.stripe_subscription_id ?? null,
    isPaid: paid,
  };
}

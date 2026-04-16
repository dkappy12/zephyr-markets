import type { TierCode, TierEntitlement } from "@/lib/billing/entitlements";
import { TIER_ENTITLEMENTS } from "@/lib/billing/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";

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
export type BillingAccessState = "paid" | "grace" | "free";

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
  accessState: BillingAccessState;
  canUsePremiumNow: boolean;
  actionRequired: "none" | "payment_method" | "new_subscription";
  statusLabel: string;
  /** When set, this user is a team member and billing follows the team owner's subscription. */
  teamMemberOfOwnerId: string | null;
};

const PAID_STATUSES = new Set(["active", "trialing"]);
const ACTION_REQUIRED_STATUSES = new Set([
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
]);
const BLOCKED_STATUSES = new Set(["unpaid", "incomplete", "incomplete_expired"]);

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

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isFutureDate(date: Date | null): boolean {
  return !!date && date.getTime() > Date.now();
}

export function isGracePaidStatus(input: {
  status: string | null | undefined;
  currentPeriodEnd: string | null;
}): boolean {
  const status = String(input.status ?? "").toLowerCase();
  if (status !== "past_due") return false;
  return isFutureDate(parseIsoDate(input.currentPeriodEnd));
}

export function toBillingAccessState(input: {
  status: string | null | undefined;
  currentPeriodEnd: string | null;
}): BillingAccessState {
  if (isPaidSubscriptionStatus(input.status)) return "paid";
  if (isGracePaidStatus(input)) return "grace";
  return "free";
}

function actionRequiredForStatus(status: string): EffectiveBillingState["actionRequired"] {
  if (ACTION_REQUIRED_STATUSES.has(status)) return "payment_method";
  if (status === "none" || status === "canceled") return "new_subscription";
  return "none";
}

function toStatusLabel(status: string): string {
  if (!status || status === "none") return "No subscription";
  return status.replace(/_/g, " ");
}

function subscriptionRowToState(data: SubscriptionRow | null): Omit<
  EffectiveBillingState,
  "teamMemberOfOwnerId"
> {
  const status = data?.status ?? "none";
  const accessState = toBillingAccessState({
    status,
    currentPeriodEnd: data?.current_period_end ?? null,
  });
  const paid = accessState === "paid" || accessState === "grace";
  const paidTier = normalizeTier(data?.tier);
  const effectiveTier: TierCode = paid ? paidTier : "free";
  const statusLower = String(status).toLowerCase();
  const actionRequired = actionRequiredForStatus(statusLower);
  const canUsePremiumNow = paid && !BLOCKED_STATUSES.has(statusLower);

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
    accessState,
    canUsePremiumNow,
    actionRequired,
    statusLabel: toStatusLabel(status),
  };
}

async function tryInheritTeamOwnerBilling(
  userId: string,
): Promise<{ state: Omit<EffectiveBillingState, "teamMemberOfOwnerId">; ownerUserId: string } | null> {
  const admin = createAdminClient();
  const { data: membership, error: memErr } = await admin
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (memErr || !membership) return null;

  const { data: team, error: teamErr } = await admin
    .from("teams")
    .select("owner_id")
    .eq("id", membership.team_id)
    .maybeSingle();
  if (teamErr || !team || team.owner_id === userId) return null;

  const ownerState = await getEffectiveBillingState(admin, team.owner_id, {
    skipTeamInheritance: true,
  });

  return { state: ownerState, ownerUserId: team.owner_id };
}

export type GetBillingStateOptions = {
  /** Skip team-seat inheritance (e.g. when resolving the team owner's own row). */
  skipTeamInheritance?: boolean;
};

export async function getEffectiveBillingState(
  supabase: unknown,
  userId: string,
  options?: GetBillingStateOptions,
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

  const base = subscriptionRowToState(data);

  if (options?.skipTeamInheritance) {
    return { ...base, teamMemberOfOwnerId: null };
  }

  const inherited = await tryInheritTeamOwnerBilling(userId);
  if (!inherited) {
    return { ...base, teamMemberOfOwnerId: null };
  }

  return {
    ...inherited.state,
    teamMemberOfOwnerId: inherited.ownerUserId,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  };
}

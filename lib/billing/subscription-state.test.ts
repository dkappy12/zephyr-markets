import { describe, expect, it } from "vitest";
import {
  getEffectiveBillingState,
  isGracePaidStatus,
  toBillingAccessState,
} from "@/lib/billing/subscription-state";

function makeSupabaseClient(data: unknown, error: { message?: string } | null = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data, error }),
        }),
      }),
    }),
  };
}

describe("billing subscription state policy", () => {
  it("treats active as paid", async () => {
    const state = await getEffectiveBillingState(
      makeSupabaseClient({
        user_id: "u1",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        tier: "pro",
        interval: "monthly",
        status: "active",
        current_period_end: null,
        cancel_at_period_end: false,
      }),
      "u1",
    );
    expect(state.effectiveTier).toBe("pro");
    expect(state.accessState).toBe("paid");
    expect(state.canUsePremiumNow).toBe(true);
  });

  it("treats past_due as grace while period end is in the future", async () => {
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const state = await getEffectiveBillingState(
      makeSupabaseClient({
        user_id: "u1",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        tier: "pro",
        interval: "monthly",
        status: "past_due",
        current_period_end: nextWeek,
        cancel_at_period_end: false,
      }),
      "u1",
    );
    expect(state.effectiveTier).toBe("pro");
    expect(state.accessState).toBe("grace");
    expect(state.canUsePremiumNow).toBe(true);
    expect(state.actionRequired).toBe("payment_method");
  });

  it("treats past_due with no period end as not in grace", async () => {
    const state = await getEffectiveBillingState(
      makeSupabaseClient({
        user_id: "u1",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        tier: "pro",
        interval: "monthly",
        status: "past_due",
        current_period_end: null,
        cancel_at_period_end: false,
      }),
      "u1",
    );
    expect(state.accessState).toBe("free");
    expect(state.effectiveTier).toBe("free");
    expect(state.canUsePremiumNow).toBe(false);
  });

  it("downgrades past_due after period end", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const state = await getEffectiveBillingState(
      makeSupabaseClient({
        user_id: "u1",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        tier: "pro",
        interval: "monthly",
        status: "past_due",
        current_period_end: yesterday,
        cancel_at_period_end: false,
      }),
      "u1",
    );
    expect(state.effectiveTier).toBe("free");
    expect(state.accessState).toBe("free");
    expect(state.canUsePremiumNow).toBe(false);
  });

  it("downgrades unpaid and incomplete statuses", async () => {
    const unpaid = await getEffectiveBillingState(
      makeSupabaseClient({
        user_id: "u1",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        tier: "pro",
        interval: "monthly",
        status: "unpaid",
        current_period_end: null,
        cancel_at_period_end: false,
      }),
      "u1",
    );
    const incomplete = await getEffectiveBillingState(
      makeSupabaseClient({
        user_id: "u1",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        tier: "pro",
        interval: "monthly",
        status: "incomplete",
        current_period_end: null,
        cancel_at_period_end: false,
      }),
      "u1",
    );
    expect(unpaid.effectiveTier).toBe("free");
    expect(unpaid.canUsePremiumNow).toBe(false);
    expect(incomplete.effectiveTier).toBe("free");
    expect(incomplete.canUsePremiumNow).toBe(false);
  });

  it("exposes pure status helpers", () => {
    const future = new Date(Date.now() + 1000).toISOString();
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isGracePaidStatus({ status: "past_due", currentPeriodEnd: null })).toBe(
      false,
    );
    expect(isGracePaidStatus({ status: "past_due", currentPeriodEnd: future })).toBe(
      true,
    );
    expect(isGracePaidStatus({ status: "past_due", currentPeriodEnd: past })).toBe(
      false,
    );
    expect(toBillingAccessState({ status: "trialing", currentPeriodEnd: null })).toBe(
      "paid",
    );
  });
});

import { describe, expect, it, vi } from "vitest";

const { mockGetEffectiveBillingState } = vi.hoisted(() => ({
  mockGetEffectiveBillingState: vi.fn(),
}));

vi.mock("@/lib/billing/subscription-state", () => ({
  getEffectiveBillingState: mockGetEffectiveBillingState,
}));

import { requireEntitlement } from "@/lib/auth/require-entitlement";

describe("requireEntitlement", () => {
  it("blocks when billing status cannot use premium", async () => {
    mockGetEffectiveBillingState.mockResolvedValue({
      effectiveTier: "free",
      entitlements: { portfolioEnabled: false },
      canUsePremiumNow: false,
      status: "unpaid",
      teamMemberOfOwnerId: null,
    });
    const result = await requireEntitlement({}, "u1", {
      feature: "portfolioEnabled",
      minimumTier: "pro",
    });
    expect(result.response?.status).toBe(403);
    const body = await result.response?.json();
    expect(body).toMatchObject({
      code: "PLAN_REQUIRED",
      billingStatus: "unpaid",
    });
  });

  it("allows grace access when entitlements match", async () => {
    mockGetEffectiveBillingState.mockResolvedValue({
      effectiveTier: "pro",
      entitlements: { portfolioEnabled: true },
      canUsePremiumNow: true,
      status: "past_due",
      teamMemberOfOwnerId: null,
    });
    const result = await requireEntitlement({}, "u1", {
      feature: "portfolioEnabled",
      minimumTier: "pro",
    });
    expect(result.response).toBeNull();
  });

  it("allows billing admin override without tier or feature gates", async () => {
    mockGetEffectiveBillingState.mockResolvedValue({
      effectiveTier: "team",
      entitlements: { apiAccess: true },
      canUsePremiumNow: true,
      status: "admin",
      teamMemberOfOwnerId: null,
    });
    const result = await requireEntitlement({}, "u1", {
      feature: "apiAccess",
      minimumTier: "team",
    });
    expect(result.response).toBeNull();
  });
});

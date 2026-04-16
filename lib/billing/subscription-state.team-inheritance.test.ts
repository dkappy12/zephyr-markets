import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

import { getEffectiveBillingState } from "@/lib/billing/subscription-state";

function makeClientForUserSubscriptionRow(data: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data, error: null }),
        }),
      }),
    }),
  };
}

describe("team-seat inheritance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inherits the team owner's paid tier when member has no subscription", async () => {
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "team_members") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: { team_id: "t1", role: "member" },
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }
        if (table === "teams") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { owner_id: "owner-1" },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "subscriptions") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    user_id: "owner-1",
                    stripe_customer_id: "cus_owner",
                    stripe_subscription_id: "sub_owner",
                    tier: "team",
                    interval: "monthly",
                    status: "active",
                    current_period_end: null,
                    cancel_at_period_end: false,
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
    mockCreateAdminClient.mockReturnValue(admin);

    const memberClient = makeClientForUserSubscriptionRow(null);
    const state = await getEffectiveBillingState(memberClient, "member-1");

    expect(state.effectiveTier).toBe("team");
    expect(state.teamMemberOfOwnerId).toBe("owner-1");
    expect(state.canUsePremiumNow).toBe(true);
    expect(state.stripeCustomerId).toBeNull();
  });

  it("does not inherit when skipTeamInheritance is true", async () => {
    const memberClient = makeClientForUserSubscriptionRow(null);
    const state = await getEffectiveBillingState(memberClient, "member-1", {
      skipTeamInheritance: true,
    });

    expect(state.effectiveTier).toBe("free");
    expect(state.teamMemberOfOwnerId).toBeNull();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});


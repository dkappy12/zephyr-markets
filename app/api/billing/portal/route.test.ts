import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockRequireUser,
  mockGetEffectiveBillingState,
  mockGetStripe,
  mockGetAppBaseUrl,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRequireUser: vi.fn(),
  mockGetEffectiveBillingState: vi.fn(),
  mockGetStripe: vi.fn(),
  mockGetAppBaseUrl: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: mockRequireUser,
}));
vi.mock("@/lib/billing/subscription-state", () => ({
  getEffectiveBillingState: mockGetEffectiveBillingState,
}));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: mockGetStripe,
}));
vi.mock("@/lib/team/invite-url", () => ({
  getAppBaseUrl: mockGetAppBaseUrl,
}));

import { POST } from "@/app/api/billing/portal/route";

describe("POST /api/billing/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({});
    mockRequireUser.mockResolvedValue({
      response: null,
      user: { id: "u1", email: "u1@example.com" },
    });
    mockGetEffectiveBillingState.mockResolvedValue({
      teamMemberOfOwnerId: null,
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    mockGetAppBaseUrl.mockReturnValue("https://zephyr.markets");
  });

  it("creates a Stripe portal session with overview return_url", async () => {
    const createPortalSession = vi.fn(async () => ({ url: "https://billing.stripe.test/session" }));
    mockGetStripe.mockReturnValue({
      customers: { list: vi.fn(), create: vi.fn() },
      billingPortal: { sessions: { create: createPortalSession } },
    });

    const res = await POST(new Request("https://zephyr.markets/api/billing/portal", { method: "POST" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.url).toBe("https://billing.stripe.test/session");
    expect(createPortalSession).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://zephyr.markets/dashboard/overview",
      flow_data: {
        type: "subscription_update",
        subscription_update: {
          subscription: "sub_1",
        },
        after_completion: {
          type: "redirect",
          redirect: {
            return_url: "https://zephyr.markets/dashboard/overview",
          },
        },
      },
    });
  });

  it("falls back to generic portal when stripeSubscriptionId is missing", async () => {
    mockGetEffectiveBillingState.mockResolvedValue({
      teamMemberOfOwnerId: null,
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: null,
    });
    const createPortalSession = vi.fn(async () => ({ url: "https://billing.stripe.test/session" }));
    mockGetStripe.mockReturnValue({
      customers: { list: vi.fn(), create: vi.fn() },
      billingPortal: { sessions: { create: createPortalSession } },
    });

    const res = await POST(
      new Request("https://zephyr.markets/api/billing/portal", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect(createPortalSession).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://zephyr.markets/dashboard/overview",
    });
  });
});


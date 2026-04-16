import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockRequireUser,
  mockGetEffectiveBillingState,
  mockGetStripe,
  mockGetAppBaseUrl,
  mockAssertSameOrigin,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRequireUser: vi.fn(),
  mockGetEffectiveBillingState: vi.fn(),
  mockGetStripe: vi.fn(),
  mockGetAppBaseUrl: vi.fn(),
  mockAssertSameOrigin: vi.fn(),
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
vi.mock("@/lib/auth/request-security", () => ({
  assertSameOrigin: mockAssertSameOrigin,
}));

import { POST } from "@/app/api/billing/checkout/route";

describe("POST /api/billing/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_monthly";
    mockCreateClient.mockResolvedValue({});
    mockRequireUser.mockResolvedValue({
      response: null,
      user: { id: "u1", email: "u1@example.com" },
    });
    mockGetEffectiveBillingState.mockResolvedValue({ teamMemberOfOwnerId: null });
    mockGetAppBaseUrl.mockReturnValue("https://zephyr.markets");
    mockAssertSameOrigin.mockReturnValue(null);
  });

  it("blocks cross-site checkout requests", async () => {
    const csrf = new Response(JSON.stringify({ code: "CSRF_BLOCKED" }), {
      status: 403,
    });
    mockAssertSameOrigin.mockReturnValue(csrf);
    const req = new Request("https://zephyr.markets/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.test" },
      body: JSON.stringify({ tier: "pro", interval: "monthly" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("creates checkout session that always returns to overview", async () => {
    const createCheckout = vi.fn(async () => ({ url: "https://checkout.stripe.test/session" }));
    mockGetStripe.mockReturnValue({
      checkout: { sessions: { create: createCheckout } },
    });

    const req = new Request("https://zephyr.markets/api/billing/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://zephyr.markets",
      },
      body: JSON.stringify({ tier: "pro", interval: "monthly" }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.url).toBe("https://checkout.stripe.test/session");
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url:
          "https://zephyr.markets/dashboard/overview?billing=success&checkout_session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://zephyr.markets/dashboard/overview?billing=cancelled",
      }),
    );
  });
});


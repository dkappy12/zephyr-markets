import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockRequireAdminUser, mockCreateAdminClient, mockGetStripe } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockRequireAdminUser: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockGetStripe: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));
vi.mock("@/lib/auth/require-admin-user", () => ({
  requireAdminUser: mockRequireAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: mockGetStripe,
}));

import { POST } from "@/app/api/admin/billing/reconcile/route";

describe("POST /api/admin/billing/reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_m";
    mockCreateClient.mockResolvedValue({});
    mockRequireAdminUser.mockResolvedValue({ response: null, user: { id: "admin-1" } });
  });

  it("returns 403 when not admin", async () => {
    const forbidden = new Response(JSON.stringify({ code: "FORBIDDEN" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
    mockRequireAdminUser.mockResolvedValue({ response: forbidden, user: null });

    const res = await POST(
      new Request("http://localhost/api/admin/billing/reconcile", {
        method: "POST",
        body: JSON.stringify({ userId: "u1" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("upserts subscription from Stripe and records an audit event", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const insert = vi.fn(async () => ({ error: null }));

    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { email: "test@example.com" } },
            error: null,
          })),
        },
      },
      from: vi.fn((table: string) => {
        if (table === "subscriptions") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              })),
            })),
            upsert,
          };
        }
        if (table === "subscription_events") {
          return { insert };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
    mockCreateAdminClient.mockReturnValue(admin);

    mockGetStripe.mockReturnValue({
      customers: {
        list: vi.fn(async () => ({ data: [{ id: "cus_1" }] })),
      },
      subscriptions: {
        list: vi.fn(async () => ({
          data: [
            {
              id: "sub_1",
              status: "active",
              created: 100,
              customer: "cus_1",
              metadata: {},
              items: {
                data: [{ price: { id: "price_pro_m", recurring: { interval: "month" } } }],
              },
              current_period_end: Math.floor(Date.now() / 1000) + 3600,
              cancel_at_period_end: false,
            },
          ],
        })),
      },
    });

    const res = await POST(
      new Request("http://localhost/api/admin/billing/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u1" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.userId).toBe("u1");
    expect(body.stripeCustomerId).toBe("cus_1");
    expect(body.stripeSubscriptionId).toBe("sub_1");
    expect(upsert).toHaveBeenCalled();
    expect(insert).toHaveBeenCalled();
  });
});


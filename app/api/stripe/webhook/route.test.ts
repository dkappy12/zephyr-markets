import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateAdminClient, mockGetStripe, mockLogEvent } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockGetStripe: vi.fn(),
  mockLogEvent: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateAdminClient,
}));

vi.mock("@/lib/billing/stripe", () => ({
  getStripe: mockGetStripe,
}));

vi.mock("@/lib/ops/logger", () => ({
  logEvent: mockLogEvent,
}));

import { POST } from "@/app/api/stripe/webhook/route";

function makeAdminClient({
  existingEventId,
  insertEventError,
}: {
  existingEventId: string | null;
  insertEventError?: { message?: string } | null;
}) {
  const insertEvent = vi.fn(async () => ({ error: insertEventError ?? null }));
  const upsertSubscription = vi.fn(async () => ({ error: null }));
  const markFailedEq = vi.fn(async () => ({ error: null }));
  const markFailedUpdate = vi.fn(() => ({ eq: markFailedEq }));

  return {
    client: {
      from: vi.fn((table: string) => {
        if (table === "subscription_events") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: existingEventId ? { id: "row-1" } : null,
                    error: null,
                  })),
                })),
              })),
            })),
            insert: insertEvent,
            update: markFailedUpdate,
          };
        }
        if (table === "subscriptions") {
          return {
            upsert: upsertSubscription,
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: { user_id: "u1" },
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    },
    insertEvent,
    upsertSubscription,
    markFailedEq,
  };
}

describe("POST /api/stripe/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_m";
  });

  it("returns 500 when webhook secret is missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it("returns 400 when stripe signature header is missing", async () => {
    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when webhook signature is invalid", async () => {
    mockGetStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => {
          throw new Error("Invalid signature");
        }),
      },
      subscriptions: {
        retrieve: vi.fn(),
      },
    });
    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("skips duplicate webhook events by stripe_event_id", async () => {
    const admin = makeAdminClient({ existingEventId: "evt_1" });
    mockCreateAdminClient.mockReturnValue(admin.client);

    mockGetStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_1",
          type: "checkout.session.completed",
          data: {
            object: {
              subscription: "sub_1",
              customer: "cus_1",
              metadata: { user_id: "u1", tier: "pro", interval: "monthly" },
              client_reference_id: "u1",
            },
          },
        })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => ({
          status: "active",
          metadata: { user_id: "u1", tier: "pro", interval: "monthly" },
          items: { data: [{ price: { id: "price_pro_m", recurring: { interval: "month" } } }] },
        })),
      },
    });

    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": "sig",
      },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(admin.insertEvent).not.toHaveBeenCalled();
    expect(admin.upsertSubscription).not.toHaveBeenCalled();
  });

  it("processes checkout.session.completed when event is new", async () => {
    const admin = makeAdminClient({ existingEventId: null });
    mockCreateAdminClient.mockReturnValue(admin.client);

    mockGetStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_new",
          type: "checkout.session.completed",
          data: {
            object: {
              subscription: "sub_new",
              customer: "cus_new",
              metadata: { user_id: "u1", tier: "pro", interval: "monthly" },
              client_reference_id: "u1",
            },
          },
        })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => ({
          status: "active",
          metadata: { user_id: "u1", tier: "pro", interval: "monthly" },
          items: {
            data: [
              { price: { id: "price_pro_m", recurring: { interval: "month" } } },
            ],
          },
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          cancel_at_period_end: false,
        })),
      },
    });

    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.duplicate).toBe(false);
    expect(body.eventId).toBe("evt_new");
    expect(admin.insertEvent).toHaveBeenCalled();
    expect(admin.upsertSubscription).toHaveBeenCalled();
  });

  it("treats duplicate-key insert race as duplicate event", async () => {
    const admin = makeAdminClient({
      existingEventId: null,
      insertEventError: { message: "duplicate key value violates unique constraint stripe_event_id" },
    });
    mockCreateAdminClient.mockReturnValue(admin.client);
    mockGetStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_race",
          type: "checkout.session.completed",
          data: {
            object: {
              subscription: "sub_1",
              customer: "cus_1",
              metadata: { user_id: "u1", tier: "pro", interval: "monthly" },
              client_reference_id: "u1",
            },
          },
        })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => ({
          status: "active",
          metadata: { user_id: "u1", tier: "pro", interval: "monthly" },
          items: { data: [{ price: { id: "price_pro_m", recurring: { interval: "month" } } }] },
        })),
      },
    });

    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(admin.upsertSubscription).not.toHaveBeenCalled();
  });

  it("processes customer.subscription.updated event", async () => {
    const admin = makeAdminClient({ existingEventId: null });
    mockCreateAdminClient.mockReturnValue(admin.client);

    mockGetStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_sub_updated",
          type: "customer.subscription.updated",
          data: {
            object: {
              id: "sub_updated",
              customer: "cus_1",
              status: "active",
              metadata: { user_id: "u1", tier: "pro", interval: "monthly" },
              items: { data: [{ price: { id: "price_pro_m", recurring: { interval: "month" } } }] },
            },
          },
        })),
      },
      subscriptions: {
        retrieve: vi.fn(),
      },
    });

    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(admin.upsertSubscription).toHaveBeenCalled();
  });

  it("processes customer.subscription.deleted event", async () => {
    const admin = makeAdminClient({ existingEventId: null });
    mockCreateAdminClient.mockReturnValue(admin.client);

    mockGetStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_sub_deleted",
          type: "customer.subscription.deleted",
          data: {
            object: {
              id: "sub_deleted",
              customer: "cus_1",
              status: "canceled",
              metadata: { user_id: "u1", tier: "pro", interval: "monthly" },
              items: { data: [{ price: { id: "price_pro_m", recurring: { interval: "month" } } }] },
            },
          },
        })),
      },
      subscriptions: {
        retrieve: vi.fn(),
      },
    });

    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(admin.upsertSubscription).toHaveBeenCalled();
  });

  it("returns 200 for unhandled webhook types without subscription mutation", async () => {
    const admin = makeAdminClient({ existingEventId: null });
    mockCreateAdminClient.mockReturnValue(admin.client);
    mockGetStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_unknown",
          type: "invoice.paid",
          data: { object: {} },
        })),
      },
      subscriptions: {
        retrieve: vi.fn(),
      },
    });
    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.duplicate).toBe(false);
    expect(admin.upsertSubscription).not.toHaveBeenCalled();
  });

  it("returns 500 on malformed checkout payload with missing ids", async () => {
    const admin = makeAdminClient({ existingEventId: null });
    mockCreateAdminClient.mockReturnValue(admin.client);

    mockGetStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_malformed",
          type: "checkout.session.completed",
          data: {
            object: {
              subscription: null,
              customer: null,
              metadata: { user_id: "u1", tier: "pro", interval: "monthly" },
              client_reference_id: "u1",
            },
          },
        })),
      },
      subscriptions: {
        retrieve: vi.fn(),
      },
    });

    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(admin.markFailedEq).toHaveBeenCalled();
  });

  it("returns 500 and logs failure when subscription upsert would fail", async () => {
    const insertEvent = vi.fn(async () => ({ error: null }));
    const upsertSubscription = vi.fn(async () => ({
      error: { message: "upsert failed" },
    }));

    const client = {
      from: vi.fn((table: string) => {
        if (table === "subscription_events") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                })),
              })),
            })),
            insert: insertEvent,
          };
        }
        if (table === "subscriptions") {
          return {
            upsert: upsertSubscription,
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: { user_id: "u1" },
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };

    mockCreateAdminClient.mockReturnValue(client);

    mockGetStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_fail",
          type: "checkout.session.completed",
          data: {
            object: {
              subscription: "sub_fail",
              customer: "cus_fail",
              metadata: { user_id: "u1", tier: "pro", interval: "monthly" },
              client_reference_id: "u1",
            },
          },
        })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => ({
          status: "active",
          metadata: { user_id: "u1", tier: "pro", interval: "monthly" },
          items: {
            data: [
              { price: { id: "price_pro_m", recurring: { interval: "month" } } },
            ],
          },
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          cancel_at_period_end: false,
        })),
      },
    });

    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "stripe_event_failed",
        scope: "billing_webhook",
      }),
    );
  });
});

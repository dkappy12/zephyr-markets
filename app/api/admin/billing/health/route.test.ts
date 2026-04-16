import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockRequireAdminUser,
  mockCreateAdminClient,
  mockCheckRateLimit,
  mockLogEvent,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRequireAdminUser: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockLogEvent: vi.fn(),
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
vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));
vi.mock("@/lib/ops/logger", () => ({
  logEvent: mockLogEvent,
}));

import { GET } from "@/app/api/admin/billing/health/route";

describe("GET /api/admin/billing/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({});
    mockRequireAdminUser.mockResolvedValue({ response: null, user: { id: "admin-1" } });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
  });

  it("returns 403 when not admin", async () => {
    const forbidden = new Response(JSON.stringify({ code: "FORBIDDEN" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
    mockRequireAdminUser.mockResolvedValue({ response: forbidden, user: null });

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns 429 when health endpoint is rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfterSec: 9 });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.code).toBe("RATE_LIMITED");
    expect(res.headers.get("Retry-After")).toBe("9");
  });

  it("summarizes recent subscription_events", async () => {
    const rows = [
      {
        stripe_event_id: "evt_1",
        event_type: "checkout.session.completed",
        processed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        user_id: "u1",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        status: "active",
        tier: "pro",
        interval: "monthly",
      },
      {
        stripe_event_id: "evt_1",
        event_type: "checkout.session.completed",
        processed_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        user_id: "u1",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        status: "active",
        tier: "pro",
        interval: "monthly",
      },
      {
        stripe_event_id: "manual_reconcile_u1_1",
        event_type: "manual.reconcile",
        processed_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        user_id: "u1",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        status: "active",
        tier: "pro",
        interval: "monthly",
      },
    ];

    const admin = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: rows, error: null })),
          })),
        })),
      })),
    };
    mockCreateAdminClient.mockReturnValue(admin);

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sampleSize).toBe(3);
    expect(body.duplicates.duplicates).toBeGreaterThanOrEqual(1);
    expect(body.manualReconciles.length).toBe(1);
  });
});


import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockRequireUser, mockAssertSameOrigin, mockCheckRateLimit } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockRequireUser: vi.fn(),
    mockAssertSameOrigin: vi.fn(),
    mockCheckRateLimit: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: mockRequireUser,
}));
vi.mock("@/lib/auth/request-security", () => ({
  assertSameOrigin: mockAssertSameOrigin,
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

import { POST } from "@/app/api/portfolio/import/route";

describe("POST /api/portfolio/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertSameOrigin.mockReturnValue(null);
    mockCreateClient.mockResolvedValue({
      from: vi.fn(() => ({
        insert: vi.fn(async () => ({ error: null })),
      })),
    });
    mockRequireUser.mockResolvedValue({
      response: null,
      user: { id: "user-1" },
    });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
  });

  it("returns validation failure for duplicate rows in one batch", async () => {
    const row = {
      instrument: "GB Power Forward",
      instrument_type: "power_forward",
      market: "GB_power",
      direction: "long",
      size: 10,
      unit: "MW",
      entry_date: "2026-01-01",
      trade_price: 100,
    };
    const req = new Request("http://localhost/api/portfolio/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: [row, row], dryRun: false }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("supports dryRun successful validation", async () => {
    const req = new Request("http://localhost/api/portfolio/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: [
          {
            instrument: "GB Power Forward",
            instrument_type: "power_forward",
            market: "GB_power",
            direction: "long",
            size: 10,
            unit: "MW",
            entry_date: "2026-01-01",
            trade_price: 100,
          },
        ],
        dryRun: true,
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockRequireUser,
  mockAssertSameOrigin,
  mockCheckRateLimit,
  mockLogAuthAuditEvent,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRequireUser: vi.fn(),
  mockAssertSameOrigin: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockLogAuthAuditEvent: vi.fn(),
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
vi.mock("@/lib/auth/audit", () => ({
  logAuthAuditEvent: mockLogAuthAuditEvent,
}));

import { POST } from "@/app/api/classify-positions/route";

describe("POST /api/classify-positions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertSameOrigin.mockReturnValue(null);
    mockCreateClient.mockResolvedValue({});
    mockRequireUser.mockResolvedValue({ response: null, user: { id: "u1" } });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  it("falls back to heuristic mode when Anthropic call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "failure",
      })),
    );

    const req = new Request("http://localhost/api/classify-positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        headers: ["instrument", "market", "side", "size"],
        rows: [
          {
            instrument: "GB Baseload M+1",
            market: "GB POWER",
            side: "BUY",
            size: "25",
          },
        ],
      }),
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.mode).toBe("fallback");
    expect(Array.isArray(body.classified)).toBe(true);
    expect(body.classified[0].keep).toBe(true);
  });

  it("normalizes model output and returns model mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify([
                  {
                    keep: true,
                    discard_reason: null,
                    instrument_type: "power",
                    market: "power",
                    direction: "buy",
                    size: "14",
                    unit: "",
                    tenor: "Q1 2027",
                    trade_price: "111.2",
                    currency: "",
                    expiry_date: null,
                    entry_date: "14/04/2026",
                    instrument: "Spark Q1-2027",
                  },
                ]),
              },
            ],
          }),
      })),
    );

    const req = new Request("http://localhost/api/classify-positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        headers: ["instrument"],
        rows: [{ instrument: "Spark Q1-2027" }],
      }),
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.mode).toBe("model");
    expect(body.classified[0].direction).toBe("long");
    expect(body.classified[0].market).toBe("other_power");
    expect(body.classified[0].currency).toBe("GBP");
    expect(Array.isArray(body.classified[0].warnings)).toBe(true);
  });
});

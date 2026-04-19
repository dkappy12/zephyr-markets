import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireApiKey, mockCreateAdminClient, mockMaybeSingle } = vi.hoisted(
  () => ({
    mockRequireApiKey: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockMaybeSingle: vi.fn(),
  }),
);

vi.mock("@/lib/api/require-api-key", () => ({
  requireApiKey: mockRequireApiKey,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

import { GET } from "@/app/api/v1/premium/route";

function requestWithApiKey(): Request {
  return new Request("https://example.com/api/v1/premium", {
    headers: { "X-API-Key": "zk_live_test" },
  });
}

describe("GET /api/v1/premium", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiKey.mockResolvedValue({
      response: null,
      userId: "u1",
      keyId: "key-1",
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: mockMaybeSingle,
            })),
          })),
        })),
      })),
    });
    mockMaybeSingle.mockResolvedValue({
      data: {
        normalised_score: 0.5,
        direction: "bullish",
        implied_price_gbp_mwh: 100,
        market_price_gbp_mwh: 95,
        srmc_gbp_mwh: 90,
        wind_gw: 10,
        solar_gw: 2,
        residual_demand_gw: 20,
        regime: "tight",
        calculated_at: "2026-01-01T12:00:00.000Z",
      },
      error: null,
    });
  });

  it("returns 401 when requireApiKey rejects the request", async () => {
    const unauthorized = Response.json(
      { error: "Missing X-API-Key header" },
      { status: 401 },
    );
    mockRequireApiKey.mockResolvedValue({ response: unauthorized });
    const res = await GET(new Request("https://example.com/api/v1/premium"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with premium payload when API key and DB row are valid", async () => {
    const res = await GET(requestWithApiKey());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.premium_score).toBe(0.5);
    expect(body.data.direction).toBe("bullish");
    expect(body.meta.endpoint).toBe("/api/v1/premium");
    expect(body.meta.model_version).toBe("1.2.0");
  });
});

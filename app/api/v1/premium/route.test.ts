import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockRequireUser, mockRequireEntitlement } = vi.hoisted(
  () => ({
    mockCreateClient: vi.fn(),
    mockRequireUser: vi.fn(),
    mockRequireEntitlement: vi.fn(),
  }),
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: mockRequireUser,
}));
vi.mock("@/lib/auth/require-entitlement", () => ({
  requireEntitlement: mockRequireEntitlement,
}));

import { GET } from "@/app/api/v1/premium/route";

describe("GET /api/v1/premium", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({});
    mockRequireUser.mockResolvedValue({ response: null, user: { id: "u1" } });
  });

  it("returns 403 when apiAccess entitlement is missing", async () => {
    const denied = Response.json(
      { code: "PLAN_REQUIRED", error: "team required" },
      { status: 403 },
    );
    mockRequireEntitlement.mockResolvedValue({ response: denied });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns 200 when team entitlement is present", async () => {
    mockRequireEntitlement.mockResolvedValue({ response: null });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

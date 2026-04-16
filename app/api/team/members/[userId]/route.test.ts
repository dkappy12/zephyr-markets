import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockRequireUser,
  mockRequireEntitlement,
  mockCreateAdminClient,
  mockAssertSameOrigin,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRequireUser: vi.fn(),
  mockRequireEntitlement: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockAssertSameOrigin: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: mockRequireUser,
}));
vi.mock("@/lib/auth/require-entitlement", () => ({
  requireEntitlement: mockRequireEntitlement,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));
vi.mock("@/lib/auth/request-security", () => ({
  assertSameOrigin: mockAssertSameOrigin,
}));

import { DELETE } from "@/app/api/team/members/[userId]/route";

describe("DELETE /api/team/members/[userId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({});
    mockRequireUser.mockResolvedValue({ response: null, user: { id: "owner-1" } });
    mockRequireEntitlement.mockResolvedValue({ response: null });
    mockAssertSameOrigin.mockReturnValue(null);
  });

  it("allows owner to remove a member", async () => {
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "teams") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: "team-1", owner_id: "owner-1" },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "team_members") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: { id: "member-row", role: "member" },
                    error: null,
                  })),
                })),
              })),
            })),
            delete: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({ error: null })),
              })),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
    mockCreateAdminClient.mockReturnValue(admin);

    const res = await DELETE(
      new Request("http://localhost", { headers: { origin: "http://localhost" } }),
      {
        params: Promise.resolve({ userId: "member-1" }),
      },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.removed).toBe(true);
  });

  it("blocks removing owner", async () => {
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "teams") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: "team-1", owner_id: "owner-1" },
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

    const res = await DELETE(
      new Request("http://localhost", { headers: { origin: "http://localhost" } }),
      {
        params: Promise.resolve({ userId: "owner-1" }),
      },
    );
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe("CANNOT_REMOVE_OWNER");
  });

  it("returns 404 for non-member target", async () => {
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "teams") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: "team-1", owner_id: "owner-1" },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "team_members") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: null,
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
    mockCreateAdminClient.mockReturnValue(admin);

    const res = await DELETE(
      new Request("http://localhost", { headers: { origin: "http://localhost" } }),
      {
        params: Promise.resolve({ userId: "missing-user" }),
      },
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe("MEMBER_NOT_FOUND");
  });
});

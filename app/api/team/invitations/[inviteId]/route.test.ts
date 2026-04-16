import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockRequireUser,
  mockRequireEntitlement,
  mockCreateAdminClient,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRequireUser: vi.fn(),
  mockRequireEntitlement: vi.fn(),
  mockCreateAdminClient: vi.fn(),
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

import { DELETE } from "@/app/api/team/invitations/[inviteId]/route";

describe("DELETE /api/team/invitations/[inviteId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({});
    mockRequireUser.mockResolvedValue({ response: null, user: { id: "owner-1" } });
    mockRequireEntitlement.mockResolvedValue({ response: null });
  });

  it("cancels a pending invite for the owner's team", async () => {
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
        if (table === "team_invitations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: "inv-1", team_id: "team-1", status: "pending" },
                  error: null,
                })),
              })),
            })),
            delete: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
    mockCreateAdminClient.mockReturnValue(admin);

    const res = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ inviteId: "inv-1" }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.cancelled).toBe(true);
  });

  it("returns conflict when invite is not pending", async () => {
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
        if (table === "team_invitations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: "inv-1", team_id: "team-1", status: "accepted" },
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

    const res = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ inviteId: "inv-1" }),
    });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("INVITE_NOT_PENDING");
  });

  it("returns not found for invite outside owner team", async () => {
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
        if (table === "team_invitations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: "inv-1", team_id: "other-team", status: "pending" },
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

    const res = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ inviteId: "inv-1" }),
    });
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe("INVITE_NOT_FOUND");
  });
});

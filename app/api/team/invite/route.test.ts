import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockRequireUser,
  mockRequireEntitlement,
  mockGetEffectiveBillingState,
  mockCreateAdminClient,
  mockAssertSameOrigin,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRequireUser: vi.fn(),
  mockRequireEntitlement: vi.fn(),
  mockGetEffectiveBillingState: vi.fn(),
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
vi.mock("@/lib/billing/subscription-state", () => ({
  getEffectiveBillingState: mockGetEffectiveBillingState,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));
vi.mock("@/lib/email/team-invite", () => ({
  sendTeamInviteEmail: vi.fn().mockResolvedValue({ sent: false, skipped: true }),
}));

import { POST } from "@/app/api/team/invite/route";

describe("POST /api/team/invite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({});
    mockRequireUser.mockResolvedValue({ response: null, user: { id: "owner-1" } });
    mockRequireEntitlement.mockResolvedValue({ response: null });
    mockGetEffectiveBillingState.mockResolvedValue({
      effectiveTier: "team",
      entitlements: { seats: 5 },
    });
    mockAssertSameOrigin.mockReturnValue(null);
  });

  it("returns SEAT_LIMIT_REACHED when active + pending reaches cap", async () => {
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "teams") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: "team-1", owner_id: "owner-1", name: "Test team" },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "team_members") {
          return {
            select: vi.fn(() => {
              const chain = {
                eq: vi.fn(() => chain),
              } as unknown as {
                eq: ReturnType<typeof vi.fn>;
              };
              chain.eq = vi.fn((column: string) => {
                if (column === "status") {
                  return Promise.resolve({ count: 4, error: null });
                }
                return chain;
              });
              return chain;
            }),
          };
        }
        if (table === "team_invitations") {
          return {
            select: vi.fn(() => {
              const chain = {
                eq: vi.fn(() => chain),
              } as unknown as {
                eq: ReturnType<typeof vi.fn>;
              };
              chain.eq = vi.fn((column: string) => {
                if (column === "status") {
                  return Promise.resolve({ count: 1, error: null });
                }
                return chain;
              });
              return chain;
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
    mockCreateAdminClient.mockReturnValue(admin);

    const req = new Request("http://localhost/api/team/invite", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      body: JSON.stringify({ email: "member@example.com" }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("SEAT_LIMIT_REACHED");
    expect(body.seatLimit).toBe(5);
  });
});

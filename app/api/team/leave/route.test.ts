import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockRequireUser,
  mockAssertSameOrigin,
  mockCreateAdminClient,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRequireUser: vi.fn(),
  mockAssertSameOrigin: vi.fn(),
  mockCreateAdminClient: vi.fn(),
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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

import { POST } from "@/app/api/team/leave/route";

describe("POST /api/team/leave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({});
    mockRequireUser.mockResolvedValue({ response: null, user: { id: "member-1" } });
    mockAssertSameOrigin.mockReturnValue(null);
  });

  it("blocks cross-site requests", async () => {
    mockAssertSameOrigin.mockReturnValue(
      new Response(JSON.stringify({ code: "CSRF_BLOCKED" }), { status: 403 }),
    );
    const res = await POST(
      new Request("http://localhost/api/team/leave", {
        method: "POST",
        origin: "https://evil.test",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when user is not a team member", async () => {
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "team_members") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                })),
              })),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
    mockCreateAdminClient.mockReturnValue(admin);

    const res = await POST(
      new Request("http://localhost/api/team/leave", {
        method: "POST",
        origin: "http://localhost",
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("NOT_A_MEMBER");
  });
});

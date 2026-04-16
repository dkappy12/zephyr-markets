import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockRequireUser,
  mockRequireEntitlement,
  mockAssertSameOrigin,
  mockCreateAdminClient,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRequireUser: vi.fn(),
  mockRequireEntitlement: vi.fn(),
  mockAssertSameOrigin: vi.fn(),
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
vi.mock("@/lib/auth/request-security", () => ({
  assertSameOrigin: mockAssertSameOrigin,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

import { POST } from "@/app/api/team/create/route";

describe("POST /api/team/create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({});
    mockRequireUser.mockResolvedValue({
      response: null,
      user: { id: "owner-1", email: "o@example.com", user_metadata: {} },
    });
    mockRequireEntitlement.mockResolvedValue({ response: null });
    mockAssertSameOrigin.mockReturnValue(null);
  });

  it("blocks cross-site requests", async () => {
    mockAssertSameOrigin.mockReturnValue(
      new Response(JSON.stringify({ code: "CSRF_BLOCKED" }), { status: 403 }),
    );
    const res = await POST(
      new Request("http://localhost/api/team/create", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.test" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("returns existing team without creating a duplicate", async () => {
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "teams") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: "team-1", name: "T" },
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

    const res = await POST(
      new Request("http://localhost/api/team/create", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ name: "My team" }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.created).toBe(false);
  });
});

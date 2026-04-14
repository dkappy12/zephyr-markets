import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateServerClient,
  mockCreateAdminClient,
  mockLogAuthAuditEvent,
  mockAssertSameOrigin,
} = vi.hoisted(() => ({
  mockCreateServerClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuthAuditEvent: vi.fn(),
  mockAssertSameOrigin: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateServerClient,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateAdminClient,
}));

vi.mock("@/lib/auth/audit", () => ({
  logAuthAuditEvent: mockLogAuthAuditEvent,
}));

vi.mock("@/lib/auth/request-security", () => ({
  assertSameOrigin: mockAssertSameOrigin,
}));

import { DELETE } from "@/app/api/account/delete/route";

type AdminMockOptions = {
  failDeleteFor?: string;
};

function makeAdminClientMock(options: AdminMockOptions = {}) {
  const deletedByEq: Array<{ table: string; column: string; value: string }> = [];
  const deletedByIn: Array<{ table: string; column: string; values: string[] }> = [];
  const teamsSelectedByOwner: string[] = [];
  const deleteUser = vi.fn(async () => ({ error: null }));

  const adminClient = {
    from: vi.fn((table: string) => ({
      insert: vi.fn(async () => ({ error: null })),
      select: vi.fn((_columns: string) => ({
        eq: vi.fn(async (column: string, value: string) => {
          if (table === "teams" && column === "owner_id") {
            teamsSelectedByOwner.push(value);
            return { data: [{ id: "team-1" }], error: null };
          }
          return { data: [], error: null };
        }),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(async (column: string, value: string) => {
          deletedByEq.push({ table, column, value });
          if (options.failDeleteFor && options.failDeleteFor === table) {
            return {
              error: { message: `forced_failure_${table}` },
            };
          }
          return { error: null };
        }),
        in: vi.fn(async (column: string, values: string[]) => {
          deletedByIn.push({ table, column, values });
          if (options.failDeleteFor && options.failDeleteFor === table) {
            return {
              error: { message: `forced_failure_${table}` },
            };
          }
          return { error: null };
        }),
      })),
    })),
    auth: {
      admin: {
        deleteUser,
      },
    },
  };

  return {
    adminClient,
    deletedByEq,
    deletedByIn,
    teamsSelectedByOwner,
    deleteUser,
  };
}

function makeServerClientMock({
  userId = "user-123",
  email = "user@example.com",
  signInError = null,
}: {
  userId?: string;
  email?: string;
  signInError?: { message: string } | null;
}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: userId, email } },
        error: null,
      })),
      signInWithPassword: vi.fn(async () => ({
        data: {},
        error: signInError,
      })),
    },
  };
}

describe("DELETE /api/account/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    mockAssertSameOrigin.mockReturnValue(null);
  });

  it("deletes user-owned rows and auth user on success", async () => {
    const serverClient = makeServerClientMock({});
    mockCreateServerClient.mockResolvedValue(serverClient);

    const admin = makeAdminClientMock();
    mockCreateAdminClient.mockReturnValue(admin.adminClient);

    const request = new Request("http://localhost/api/account/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "correct-password" }),
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true });
    expect(admin.deleteUser).toHaveBeenCalledWith("user-123");

    const deletedTablesByEq = admin.deletedByEq.map((entry) => entry.table);
    expect(deletedTablesByEq).toEqual(
      expect.arrayContaining([
        "alerts",
        "email_trade_imports",
        "attribution_predictions",
        "portfolio_pnl",
        "positions",
        "team_members",
        "team_invitations",
        "teams",
        "profiles",
      ]),
    );

    const deletedTablesByIn = admin.deletedByIn.map((entry) => entry.table);
    expect(deletedTablesByIn).toEqual(
      expect.arrayContaining(["team_invitations", "team_members"]),
    );
    expect(admin.teamsSelectedByOwner).toEqual(["user-123"]);
  });

  it("returns PASSWORD_INVALID and skips cleanup when password is wrong", async () => {
    const serverClient = makeServerClientMock({
      signInError: { message: "Invalid login credentials" },
    });
    mockCreateServerClient.mockResolvedValue(serverClient);

    const request = new Request("http://localhost/api/account/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      code: "PASSWORD_INVALID",
      error: "Invalid password.",
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});

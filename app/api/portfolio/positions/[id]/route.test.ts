import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockRequireUser,
  mockAssertSameOrigin,
  mockLogAuthAuditEvent,
  mockMaybeSingle,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRequireUser: vi.fn(),
  mockAssertSameOrigin: vi.fn(),
  mockLogAuthAuditEvent: vi.fn(),
  mockMaybeSingle: vi.fn(),
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
vi.mock("@/lib/auth/audit", () => ({
  logAuthAuditEvent: mockLogAuthAuditEvent,
}));

import { DELETE } from "@/app/api/portfolio/positions/[id]/route";

describe("DELETE /api/portfolio/positions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertSameOrigin.mockReturnValue(null);
    mockRequireUser.mockResolvedValue({ response: null, user: { id: "u1" } });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockCreateClient.mockResolvedValue({
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: mockMaybeSingle,
              })),
            })),
          })),
        })),
      })),
    });
  });

  it("returns not found when row not owned/found", async () => {
    const req = new Request("http://localhost/api/portfolio/positions/p1", {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: "p1" }) });
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe("POSITION_NOT_FOUND");
  });
});

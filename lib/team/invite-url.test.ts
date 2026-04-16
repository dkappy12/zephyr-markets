import { describe, expect, it } from "vitest";
import { getAppBaseUrl } from "@/lib/team/invite-url";

describe("getAppBaseUrl", () => {
  it("prefers request origin over NEXT_PUBLIC_APP_URL", () => {
    const originalEnv = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const req = new Request("https://zephyr.markets/api/billing/portal", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "zephyr.markets",
      },
    });
    expect(getAppBaseUrl(req)).toBe("https://zephyr.markets");
    process.env.NEXT_PUBLIC_APP_URL = originalEnv;
  });
});


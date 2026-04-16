import { describe, expect, it } from "vitest";
import { getAppBaseUrl } from "@/lib/team/invite-url";

describe("getAppBaseUrl", () => {
  it("uses NEXT_PUBLIC_APP_URL in production even when forwarded host differs", () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://zephyr.markets";
    try {
      const req = new Request("https://evil.test/api/billing/portal", {
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "evil.test",
        },
      });
      expect(getAppBaseUrl(req)).toBe("https://zephyr.markets");
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      process.env.NEXT_PUBLIC_APP_URL = prevUrl;
    }
  });

  it("infers origin from request when not in production", () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NODE_ENV = "test";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    try {
      const req = new Request("https://zephyr.markets/api/billing/portal", {
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "zephyr.markets",
        },
      });
      expect(getAppBaseUrl(req)).toBe("https://zephyr.markets");
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      process.env.NEXT_PUBLIC_APP_URL = prevUrl;
    }
  });
});

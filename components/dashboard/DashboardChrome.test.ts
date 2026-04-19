import { describe, expect, it } from "vitest";
import { tierBadgeLabel } from "@/components/dashboard/DashboardChrome";

describe("tierBadgeLabel", () => {
  it("shows pro and team only", () => {
    expect(tierBadgeLabel("free")).toBeNull();
    expect(tierBadgeLabel("pro")).toBe("pro");
    expect(tierBadgeLabel("team")).toBe("team");
    expect(tierBadgeLabel(null)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { physicalRemitSignalCardImpact } from "@/lib/portfolio/attribution";

describe("physicalRemitSignalCardImpact", () => {
  it("is zero in the flat residual band (no £/MWh)", () => {
    const r = physicalRemitSignalCardImpact(500, 10, false, 18, 1);
    expect(r.gbpPerMwh).toBe(0);
    expect(r.displayGbp).toBe(0);
    expect(r.zeroHint).toBe("residual_demand_regime");
  });

  it("uses net MW with £1 display rounding when not flat", () => {
    const r = physicalRemitSignalCardImpact(2000, -5, false, 22, 1);
    expect(r.gbpPerMwh).toBeCloseTo(1.0, 5);
    expect(r.rawGbp).toBeCloseTo(-5, 5);
    expect(r.displayGbp).toBe(-5);
    expect(r.zeroHint).toBe("none");
  });

  it("returns mixed hint when book is long and short GB", () => {
    const r = physicalRemitSignalCardImpact(400, 0, true, 22, 1);
    expect(r.zeroHint).toBe("mixed_gb_net");
    expect(r.displayGbp).toBe(0);
  });
});

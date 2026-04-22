import { describe, expect, it } from "vitest";
import {
  historicalSpreadGbpMwh,
  isSparkSpread,
  sparkSpreadGbpMwh,
  sparkSpreadStressDeltaGbpMwh,
} from "./spread-marks";

describe("spread-marks", () => {
  it("spark is N2ex minus SRMC(TTF) for typical inputs", () => {
    const s = sparkSpreadGbpMwh(100, 50, 0.86);
    expect(s).toBeLessThan(100);
    expect(Number.isFinite(s)).toBe(true);
  });

  it("historicalSpreadGbpMwh uses instrument_type", () => {
    const spark = historicalSpreadGbpMwh(
      { instrument_type: "spark_spread" },
      100,
      50,
      0.86,
    );
    const outright = historicalSpreadGbpMwh(
      { instrument_type: "power_forward" },
      100,
      50,
      0.86,
    );
    expect(spark).not.toBeNull();
    expect(outright).toBeNull();
  });

  it("isSparkSpread", () => {
    expect(
      isSparkSpread({ instrument_type: "SPARK_SPREAD" }),
    ).toBe(true);
    expect(isSparkSpread({ instrument_type: "gas_forward" })).toBe(
      false,
    );
  });

  it("sparkSpreadStressDeltaGbpMwh increases with N2ex shock", () => {
    const a = sparkSpreadStressDeltaGbpMwh(10, 0, 0.86);
    const b = sparkSpreadStressDeltaGbpMwh(20, 0, 0.86);
    expect(b).toBeGreaterThan(a);
  });
});

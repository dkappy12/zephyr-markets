import { describe, expect, it } from "vitest";
import {
  aggregateDailyGasPrices,
  buildNbpPthByDayFromGasRows,
  NBP_DEPRECATED_YAHOO_HUB,
} from "@/lib/portfolio/gas-aggregate";

describe("buildNbpPthByDayFromGasRows", () => {
  it("merges Stooq NBP p/th with deprecated TTF proxy; Stooq wins on overlap", () => {
    const fxByDay: Record<string, number> = {
      "2026-01-01": 0.86,
      "2026-01-02": 0.86,
    };
    const rows = [
      {
        price_time: "2026-01-01T12:00:00.000Z",
        price_eur_mwh: 100,
        hub: "NBP",
      },
      {
        price_time: "2026-01-02T12:00:00.000Z",
        price_eur_mwh: 110,
        hub: "NBP",
      },
      {
        price_time: "2026-01-02T12:00:00.000Z",
        price_eur_mwh: 15,
        hub: NBP_DEPRECATED_YAHOO_HUB,
      },
    ] as const;
    const byDay = buildNbpPthByDayFromGasRows(
      rows.map((r) => ({ ...r })),
      fxByDay,
    );
    expect(byDay["2026-01-01"]).toBeCloseTo(100, 6);
    expect(byDay["2026-01-02"]).toBeCloseTo(110, 6);
  });

  it("fills a gap with deprecated TTF → p/th when Stooq has no print", () => {
    const day = "2026-01-15";
    const fxByDay: Record<string, number> = { [day]: 0.86 };
    const ttfEur = 20;
    const fromDeprecated = aggregateDailyGasPrices(
      [
        {
          price_time: `${day}T00:00:00.000Z`,
          price_eur_mwh: ttfEur,
          hub: NBP_DEPRECATED_YAHOO_HUB,
        },
      ],
      { kind: "NBP" },
    );
    expect(Object.keys(fromDeprecated).length).toBe(0);

    const byDay = buildNbpPthByDayFromGasRows(
      [
        {
          price_time: `${day}T00:00:00.000Z`,
          price_eur_mwh: ttfEur,
          hub: NBP_DEPRECATED_YAHOO_HUB,
        },
      ],
      fxByDay,
    );
    expect(byDay[day]).toBeGreaterThan(30);
  });
});

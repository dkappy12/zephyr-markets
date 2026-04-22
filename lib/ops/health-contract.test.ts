import { describe, expect, it } from "vitest";
import { isCompleteHealthCheckResponse } from "./health-contract";

describe("health-contract", () => {
  it("accepts a full successful health payload shape", () => {
    const payload = {
      ok: true,
      checkedAt: "2026-04-22T12:00:00.000Z",
      service: "zephyr-markets",
      checks: {
        env: true,
        supabase: "ok",
        portfolioFeeds: "ok",
        portfolioTables: "ok",
      },
      portfolioDataPlane: {
        portfolioPnl: "ok",
        positions: "ok",
      },
      feedHealth: {
        powerAgeHours: 2,
        gasAgeHours: 3,
        fxAgeDays: 1,
        carbonAgeDays: 2,
        warnings: [],
      },
    };
    expect(isCompleteHealthCheckResponse(payload)).toBe(true);
  });

  it("rejects missing portfolioDataPlane", () => {
    const payload = {
      ok: true,
      checkedAt: "2026-04-22T12:00:00.000Z",
      service: "zephyr-markets",
      checks: {
        env: true,
        supabase: "ok",
        portfolioFeeds: "ok",
        portfolioTables: "ok",
      },
      feedHealth: {
        powerAgeHours: null,
        gasAgeHours: null,
        fxAgeDays: null,
        carbonAgeDays: null,
        warnings: [],
      },
    };
    expect(isCompleteHealthCheckResponse(payload)).toBe(false);
  });

  it("rejects wrong service name", () => {
    expect(
      isCompleteHealthCheckResponse({
        ok: true,
        checkedAt: "x",
        service: "other",
        checks: {
          env: true,
          supabase: "ok",
          portfolioFeeds: "ok",
          portfolioTables: "ok",
        },
        portfolioDataPlane: { portfolioPnl: "ok", positions: "ok" },
        feedHealth: {
          powerAgeHours: null,
          gasAgeHours: null,
          fxAgeDays: null,
          carbonAgeDays: null,
          warnings: [],
        },
      }),
    ).toBe(false);
  });
});

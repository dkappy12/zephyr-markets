import { describe, expect, it } from "vitest";
import {
  PORTFOLIO_API_LOG_EVENTS,
  type PortfolioApiLogEventName,
} from "./portfolio-api-events";

describe("portfolio-api-events", () => {
  it("has stable string values for ops / log filters", () => {
    expect(PORTFOLIO_API_LOG_EVENTS.attributionSnapshotUpsertFailed).toBe(
      "attribution_snapshot_upsert_failed",
    );
    expect(PORTFOLIO_API_LOG_EVENTS.importInsertFailed).toBe(
      "import_insert_failed",
    );
    expect(PORTFOLIO_API_LOG_EVENTS.optimiseDataLoadFailed).toBe(
      "optimise_data_load_failed",
    );
  });

  it("values are unique", () => {
    const vals = Object.values(
      PORTFOLIO_API_LOG_EVENTS,
    ) as PortfolioApiLogEventName[];
    expect(new Set(vals).size).toBe(vals.length);
  });
});

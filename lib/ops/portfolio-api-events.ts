/**
 * Canonical `scope: "portfolio_api"` log `event` strings.
 * Route handlers should reference these so tests and ops stay aligned.
 */
export const PORTFOLIO_API_LOG_EVENTS = {
  attributionSnapshotUpsertFailed: "attribution_snapshot_upsert_failed",
  importPositionCountFailed: "import_position_count_failed",
  importInsertFailed: "import_insert_failed",
  optimiseDataLoadFailed: "optimise_data_load_failed",
  optimiseRecommendationsException: "optimise_recommendations_exception",
} as const;

export type PortfolioApiLogEventName =
  (typeof PORTFOLIO_API_LOG_EVENTS)[keyof typeof PORTFOLIO_API_LOG_EVENTS];

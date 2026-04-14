/**
 * Shared desk language for Book → Risk → Attribution → Optimise (aligned with Overview).
 */

export const DESK_DASH = "—";

/** Tooltip / helper when P&L or mark cannot be computed */
export const DASH_MISSING_MARK =
  "No live mark for this market/unit — check data feed or position fields.";

export const DASH_MISSING_HISTORY =
  "Insufficient overlapping price history to compute this series.";

export const DASH_NOT_APPLICABLE = "Not applicable for this position type.";

/** Physical premium vs tape (GB power focus; gas as context) */
export const PREMIUM_VS_TAPE =
  "Physical premium compares model-implied GB power price to N2EX tape; TTF/NBP are separate legs.";

/** Risk page: historical vs hypothetical stress */
export const RISK_HISTORICAL_NOTE =
  "Historical VaR uses realised daily moves on your book. Scenario cards apply stylised price shocks — illustrative, not forecasts.";

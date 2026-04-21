/**
 * Daily GB power price aggregation shared between Risk and Optimise.
 *
 * Both pages must produce the same daily mark series for the same window,
 * otherwise portfolio-level P&L and hedge scenarios diverge. Previously the
 * Optimise route relied on a Supabase RPC (`get_daily_power_prices`) that
 * returned a pre-baked daily average with no coverage or volume checks,
 * while the Risk page built its own aggregation with volume-weighting,
 * de-duplication, and a minimum-periods-per-day coverage threshold.
 */

export type PowerPriceSample = {
  price_date: string;
  price_gbp_mwh: number | null;
  settlement_period: number | null;
  volume: number | null;
};

/**
 * Minimum distinct settlement periods required for a day's mark to be
 * published. Below this, the day is dropped to avoid manufacturing fake
 * day-over-day deltas between a fully-covered day and a peak-only day.
 */
export const MIN_POWER_PERIODS_PER_DAY = 24;

/**
 * Build a single daily GBP/MWh mark per date by:
 *   1. De-duplicating rows by (date, settlement_period) — repeated upserts
 *      (e.g. MID rebuilds) must not count twice.
 *   2. Volume-weighting when a volume is present.
 *   3. Requiring at least `MIN_POWER_PERIODS_PER_DAY` distinct periods.
 */
export function aggregateDailyPowerPrices(
  rows: PowerPriceSample[],
): Record<string, number> {
  type Cell = {
    weightedSum: number;
    weight: number;
    unweightedSum: number;
    unweightedCount: number;
  };
  const bySettlement = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const d = row.price_date;
    const p = Number(row.price_gbp_mwh);
    if (!Number.isFinite(p) || p <= 0) continue;
    const period = row.settlement_period ?? 0;
    let dayMap = bySettlement.get(d);
    if (!dayMap) {
      dayMap = new Map<number, number>();
      bySettlement.set(d, dayMap);
    }
    dayMap.set(period, p);
  }
  const volumeByKey = new Map<string, number>();
  for (const row of rows) {
    const v = row.volume == null ? null : Number(row.volume);
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    const key = `${row.price_date}#${row.settlement_period ?? 0}`;
    volumeByKey.set(key, v);
  }
  const aggregated = new Map<string, Cell>();
  for (const [date, periodMap] of bySettlement) {
    for (const [period, price] of periodMap) {
      const cell = aggregated.get(date) ?? {
        weightedSum: 0,
        weight: 0,
        unweightedSum: 0,
        unweightedCount: 0,
      };
      const vol = volumeByKey.get(`${date}#${period}`) ?? 0;
      if (vol > 0) {
        cell.weightedSum += price * vol;
        cell.weight += vol;
      }
      cell.unweightedSum += price;
      cell.unweightedCount += 1;
      aggregated.set(date, cell);
    }
  }
  const out: Record<string, number> = {};
  for (const [date, cell] of aggregated) {
    if (cell.unweightedCount < MIN_POWER_PERIODS_PER_DAY) continue;
    out[date] =
      cell.weight > 0
        ? cell.weightedSum / cell.weight
        : cell.unweightedSum / cell.unweightedCount;
  }
  return out;
}

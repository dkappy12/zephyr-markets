/**
 * Daily gas price aggregation shared between Risk and Optimise.
 *
 * Both pages must produce the same daily mark series for the same window,
 * otherwise portfolio-level P&L and hedge scenarios diverge. This helper
 * centralises the aggregation and — critically — applies absolute-level
 * sanity floors that catch feed artefacts (e.g. Stooq NF.F occasionally
 * prints NBP in the 10–20 p/th range when its upstream source glitches;
 * TTF has historically shown zero/near-zero spurious prints).
 *
 * We do **not** impose a minimum-samples-per-day threshold the way
 * {@link aggregateDailyPowerPrices} does, because both TTF and NBP feeds
 * deliver one daily close by design — raising the floor to 2 samples/day
 * would simply drop the entire series. The defense against a single bad
 * print lives at two layers instead:
 *   1. Here: reject implausible absolute levels up-front so they never
 *      reach the aggregator.
 *   2. In {@link calculateDailyPnL}: cap day-over-day moves so even if a
 *      bad level slips through once, the Δ it produces against a good
 *      level on the next day is clamped before it hits P&L.
 */

export type GasPriceSample = {
  price_time: string;
  price_eur_mwh: number | null;
};

/**
 * Minimum plausible NBP day-ahead level in pence/therm. Anything below
 * this is treated as a feed artefact rather than a real print. Modern-era
 * NBP has not traded below this level in years; the 2020 COVID-trough
 * lows were around 15 p/th only for a few intra-day prints, not daily
 * settles, and even then carbon costs alone have kept settles >= 30 p/th
 * since the UK ETS launched.
 */
export const NBP_LEVEL_FLOOR_PTH = 30;

/**
 * Minimum plausible TTF day-ahead level in EUR/MWh. Europe saw EUR 5–10
 * prints during 2020 but today's carbon floor and TTF-vs-JKM arb keep
 * even the softest shoulder-month settles above this line.
 */
export const TTF_LEVEL_FLOOR_EUR_MWH = 10;

/**
 * Build a single daily mark per date for a hub-filtered price series.
 * Filters non-finite, non-positive, and sub-floor values, then averages
 * whatever survives per day (mean, not volume-weighted — gas daily
 * closes don't carry a volume column today).
 *
 * @param rows    Hub-filtered gas price rows. Callers are expected to
 *                pre-filter `gas_prices` on hub before passing in, so this
 *                function is unit-agnostic: pass €/MWh for TTF, p/th for
 *                NBP (matching the way the table actually stores them).
 * @param options `kind` selects the level floor to apply. No other
 *                behaviour changes based on kind today.
 */
export function aggregateDailyGasPrices(
  rows: GasPriceSample[],
  options: { kind: "TTF" | "NBP" },
): Record<string, number> {
  const floor =
    options.kind === "NBP" ? NBP_LEVEL_FLOOR_PTH : TTF_LEVEL_FLOOR_EUR_MWH;
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const timestamp = row.price_time ?? "";
    if (typeof timestamp !== "string" || timestamp.length < 10) continue;
    const day = timestamp.slice(0, 10);
    const price = Number(row.price_eur_mwh);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (price < floor) continue;
    const cell = buckets.get(day) ?? { sum: 0, count: 0 };
    cell.sum += price;
    cell.count += 1;
    buckets.set(day, cell);
  }
  const out: Record<string, number> = {};
  for (const [day, cell] of buckets) {
    if (cell.count === 0) continue;
    out[day] = cell.sum / cell.count;
  }
  return out;
}

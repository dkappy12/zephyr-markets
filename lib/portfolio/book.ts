/** Fallback GBP/EUR rate used when live fx_rates data is unavailable. Live rate fetched from Supabase fx_rates table in page components. */
export const GBP_PER_EUR = 0.86;
/** Therms per MWh: 1 MWh = 34.121 therms (1 therm = 29.3071 kWh). */
export const MWH_TO_THERM = 34.121;

export type PositionRow = {
  id: string;
  user_id: string;
  created_at: string;
  direction: string | null;
  expiry_date: string | null;
  instrument: string | null;
  instrument_type: string | null;
  is_hypothetical: boolean | null;
  market: string | null;
  size: number | null;
  tenor: string | null;
  trade_price: number | null;
  unit: string | null;
  currency: string | null;
  source: string | null;
  notes: string | null;
  is_closed: boolean | null;
  close_price: number | null;
  close_date: string | null;
  entry_date: string | null;
  raw_csv_row: string | null;
};

export type ClassifiedPosition = {
  keep: boolean;
  discard_reason: string | null;
  instrument_type: string | null;
  market: string | null;
  direction: "long" | "short" | null;
  size: number | null;
  unit: string | null;
  tenor: string | null;
  trade_price: number | null;
  currency: string | null;
  expiry_date: string | null;
  entry_date: string | null;
  instrument: string | null;
  original_row: Record<string, unknown> | null;
  warnings?: string[];
};

/** Always show sign with £ */
export function formatGbpColored(n: number): { text: string; className: string } {
  const sign = n >= 0 ? "+" : "−";
  const v = Math.abs(n);
  const formatted = v.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return {
    text: `${sign}£${formatted}`,
    className: n >= 0 ? "text-[#1D6B4E]" : "text-[#8B3A3A]",
  };
}

/** Shared direction parser for portfolio math paths. */
export function positionDirectionSign(direction: string | null): number {
  const d = (direction ?? "").toLowerCase();
  if (d === "long") return 1;
  if (d === "short") return -1;
  return 0;
}

export function netDeltaMw(openPositions: PositionRow[]): {
  label: string;
  isMixed: boolean;
} {
  let delta = 0;
  let mwCount = 0;
  for (const p of openPositions) {
    const u = (p.unit ?? "").toLowerCase();
    if (u !== "mw") continue;
    mwCount++;
    const s = Number(p.size) || 0;
    if (p.direction === "long") delta += s;
    else if (p.direction === "short") delta -= s;
  }
  if (mwCount === 0) {
    return { label: "Mixed units", isMixed: true };
  }
  if (delta > 0) {
    return {
      label: `+${delta.toLocaleString("en-GB", { maximumFractionDigits: 1 })} MW net long`,
      isMixed: false,
    };
  }
  if (delta < 0) {
    return {
      label: `−${Math.abs(delta).toLocaleString("en-GB", { maximumFractionDigits: 1 })} MW net short`,
      isMixed: false,
    };
  }
  return { label: "0 MW flat", isMixed: false };
}

/** Bucket MW-unit positions by market family so the header can disclose that
 * "+66 MW net long" is really GB + Continental + TTF combined. */
export type NetDeltaBucket = "GB_POWER" | "TTF" | "CONTINENTAL" | "OTHER";

function netDeltaBucket(market: string | null): NetDeltaBucket {
  const m = (market ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (m === "gb_power" || m === "n2ex" || m === "apx") return "GB_POWER";
  if (m === "ttf") return "TTF";
  if (
    m.includes("nordic") ||
    m.includes("german") ||
    m.includes("de_power") ||
    m.includes("french") ||
    m.includes("fr_power")
  ) {
    return "CONTINENTAL";
  }
  return "OTHER";
}

/**
 * Per-market MW net delta. The Book header previously displayed a single
 * "+X MW net long" that summed GB + TTF + Nordic + DE + FR silently — a
 * trader would reasonably assume the number was GB-only. This breakdown
 * lets the UI render "GB +X · TTF +Y · Continental +Z" instead.
 */
export function netDeltaMwByMarket(
  openPositions: PositionRow[],
): Array<{ bucket: NetDeltaBucket; mw: number; count: number }> {
  const byBucket = new Map<NetDeltaBucket, { mw: number; count: number }>();
  for (const p of openPositions) {
    const u = (p.unit ?? "").toLowerCase();
    if (u !== "mw") continue;
    const bucket = netDeltaBucket(p.market);
    const s = Number(p.size) || 0;
    const signed =
      p.direction === "long" ? s : p.direction === "short" ? -s : 0;
    const existing = byBucket.get(bucket) ?? { mw: 0, count: 0 };
    existing.mw += signed;
    existing.count += 1;
    byBucket.set(bucket, existing);
  }
  const order: NetDeltaBucket[] = ["GB_POWER", "TTF", "CONTINENTAL", "OTHER"];
  return order
    .filter((b) => byBucket.has(b))
    .map((b) => ({ bucket: b, ...(byBucket.get(b) as { mw: number; count: number }) }));
}

export function linearPnl(
  direction: string | null,
  tradePrice: number | null,
  currentPrice: number | null,
  size: number | null,
): number | null {
  if (
    tradePrice == null ||
    currentPrice == null ||
    size == null ||
    !Number.isFinite(tradePrice) ||
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(size)
  ) {
    return null;
  }
  const d = direction?.toLowerCase();
  if (d === "long") return (currentPrice - tradePrice) * size;
  if (d === "short") return (tradePrice - currentPrice) * size;
  return null;
}

export type LivePrices = {
  gbPowerGbpMwh: number | null;
  gbPowerOpenGbpMwh: number | null;
  ttfEurMwh: number | null;
  /** Same as ttfEurMwh × gbpPerEur — for display only; P&amp;L uses EUR × rate. */
  ttfGbpMwh: number | null;
  ttfOpenEurMwh: number | null;
  ttfOpenGbpMwh: number | null;
  nbpPencePerTherm: number | null;
  nbpOpenPencePerTherm: number | null;
  /** EUR→GBP for TTF £ bridge and TTF P&amp;L (live from fx_rates or {@link GBP_PER_EUR}). */
  gbpPerEur: number;
  /**
   * True when `gbpPerEur` is the hardcoded {@link GBP_PER_EUR} fallback
   * rather than a value fetched from the `fx_rates` table. UI surfaces
   * a warning badge when this flag is set so users know EUR-denominated
   * P&amp;L, TTF £ marks and gas attribution may be slightly stale.
   */
  gbpPerEurIsFallback?: boolean;
  /**
   * Age in days of the newest `fx_rates` EUR→GBP row used. Undefined
   * when the table is empty (fallback is used). Values &gt; 3 suggest
   * the daily FX loader has stalled.
   */
  gbpPerEurAgeDays?: number;
  ukaGbpPerT: number | null;
  euaEurPerT: number | null;
  euaGbpPerT: number | null;
  /** Prior calendar day UKA close (GBP/t) for daily "today" P&amp;L, when loaded. */
  ukaGbpPerTPrev: number | null;
  /** Prior calendar day EUA close (EUR/t) for daily "today" P&amp;L, when loaded. */
  euaEurPerTPrev: number | null;
};

/** TTF (and EUR/MWh) P&amp;L in £: diff in EUR/MWh × size, then × `gbpPerEur`. */
export function eurMwhPnlToGbp(
  direction: string | null,
  entryEurMwh: number | null,
  markEurMwh: number | null,
  sizeMwh: number | null,
  gbpPerEur: number = GBP_PER_EUR,
): number | null {
  const eur = linearPnl(direction, entryEurMwh, markEurMwh, sizeMwh);
  if (eur == null) return null;
  return eur * gbpPerEur;
}

/**
 * NBP forward proxy from TTF (EUR/MWh): £/MWh → £/therm, then to pence/therm.
 * p/th = (TTF_eur × gbp_per_eur / therms_per_mwh) × 100.
 */
export function ttfToNbpPencePerTherm(
  ttfEurMwh: number,
  gbpPerEur: number = GBP_PER_EUR,
): number {
  const gbpMwh = ttfEurMwh * gbpPerEur;
  return (gbpMwh / MWH_TO_THERM) * 100;
}

/**
 * P&L in £ for NBP when entry/current are p/th and size is therms:
 * (price diff in p/th) × therms = total pence → divide by 100 for £.
 */
export function nbpPnlGbp(
  direction: string | null,
  entryPencePerTherm: number | null,
  currentPencePerTherm: number | null,
  sizeTherms: number | null,
): number | null {
  const raw = linearPnl(
    direction,
    entryPencePerTherm,
    currentPencePerTherm,
    sizeTherms,
  );
  if (raw == null) return null;
  return raw / 100;
}

/**
 * Canonical market bucket derived from the free-text `market` column. Mirrors
 * the narrower switch used by the Book page so helpers that need the same
 * market-specific unit suffixes (entry price formatting, notional computation,
 * import preview) stay in sync.
 */
export type MarketBucket =
  | "GB_POWER"
  | "TTF"
  | "NBP"
  | "UKA"
  | "EUA"
  | "OTHER_POWER"
  | "OTHER_GAS"
  | "OTHER";

export function normaliseMarketBucket(
  value: string | null | undefined,
): MarketBucket {
  const raw = (value ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "gb_power" || raw === "n2ex" || raw === "apx") return "GB_POWER";
  if (raw === "ttf") return "TTF";
  if (raw === "nbp") return "NBP";
  if (raw === "uka") return "UKA";
  if (raw === "eua") return "EUA";
  if (raw === "other_power" || raw.includes("power")) return "OTHER_POWER";
  if (raw === "other_gas" || raw.includes("gas")) return "OTHER_GAS";
  return "OTHER";
}

/**
 * Format the entry `trade_price` for display with the correct unit suffix
 * per market: £/MWh for GB power, €/MWh for TTF / NW European power, p/th for
 * NBP, £/t or €/t for UKA / EUA. Shared by the Book grid and the CSV import
 * preview so both surfaces agree (previously the preview labelled every EUR
 * quote `@ X EUR` and every GBP quote `@ £X/MWh`, which mis-labelled UKA and
 * EUA).
 */
function fmt2(n: number): string {
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPositionEntryPrice(
  p: Pick<PositionRow, "trade_price" | "market" | "unit" | "currency" | "instrument_type">,
): string {
  if (p.trade_price == null || !Number.isFinite(p.trade_price)) return "—";
  const it = (p.instrument_type ?? "").toLowerCase();
  if (it === "spark_spread" || it === "dark_spread") {
    return `£${fmt2(p.trade_price)}/MWh (spread)`;
  }
  const market = normaliseMarketBucket(p.market);
  const unit = (p.unit ?? "").toLowerCase();
  const ccy = (p.currency ?? "").toUpperCase();
  const price = fmt2(p.trade_price);

  if (market === "NBP" || unit.includes("therm")) return `${price}p/th`;
  if (market === "GB_POWER") return `£${price}/MWh`;
  if (market === "TTF") return `€${price}/MWh`;
  if (market === "UKA") return `£${price}/t`;
  if (market === "EUA") return ccy === "GBP" ? `£${price}/t` : `€${price}/t`;
  if (market === "OTHER_POWER" || market === "OTHER_GAS") {
    return ccy === "EUR" ? `€${price}/MWh` : `£${price}/MWh`;
  }
  return ccy === "EUR" ? `€${price}` : `£${price}`;
}

/**
 * Best-effort derivation of an ISO expiry date (YYYY-MM-DD) from a free-text
 * tenor label. Handles the canonical tenor shapes produced by QuickAddModal
 * (Spot / Day-ahead / Balance of month / Month+N / Q1-Q4 YYYY / Win YYYY-YY
 * / Sum YYYY / Cal YYYY) plus common CSV shapes seen from broker/ETRM feeds
 * (Jan-26, Jan 2026, Mar26, Q1-26, pure year).
 *
 * Returns the *last* day of the delivery window — i.e. when the contract
 * finishes delivering — so that tenor-concentration bucketing on the Risk
 * page has a meaningful date even when the user didn't fill in expiry_date.
 */
export function tenorToExpiryDate(
  tenor: string | null | undefined,
  referenceDate: Date = new Date(),
): string | null {
  if (!tenor) return null;
  const t = tenor.trim();
  if (!t) return null;
  const toIso = (year: number, monthIdx0: number, day: number) => {
    const d = new Date(Date.UTC(year, monthIdx0, day));
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  };
  const lastDayOfMonth = (year: number, monthIdx0: number) =>
    new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();
  const refYear = referenceDate.getUTCFullYear();
  const refMonth = referenceDate.getUTCMonth();
  const normYear = (yy: number) => (yy < 100 ? 2000 + yy : yy);

  const lower = t.toLowerCase();

  if (lower === "spot" || lower === "prompt") {
    return referenceDate.toISOString().slice(0, 10);
  }
  if (lower === "day-ahead" || lower === "day ahead" || lower === "da") {
    const d = new Date(referenceDate);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (lower === "balance of month" || lower === "bom") {
    return toIso(refYear, refMonth, lastDayOfMonth(refYear, refMonth));
  }

  const monthPlus = lower.match(/^month\s*[+]?\s*(\d+)$/);
  if (monthPlus) {
    const n = Number(monthPlus[1]);
    const m = refMonth + n;
    const y = refYear + Math.floor(m / 12);
    const mm = ((m % 12) + 12) % 12;
    return toIso(y, mm, lastDayOfMonth(y, mm));
  }

  const cal = lower.match(/^cal\s*[- ]?\s*(\d{2,4})$/);
  if (cal) {
    const y = normYear(Number(cal[1]));
    return toIso(y, 11, 31);
  }

  const q = lower.match(/^q([1-4])\s*[- ]?\s*(\d{2,4})$/);
  if (q) {
    const qn = Number(q[1]);
    const y = normYear(Number(q[2]));
    const endMonthIdx = qn * 3 - 1; // Q1→Mar(2), Q2→Jun(5), Q3→Sep(8), Q4→Dec(11)
    return toIso(y, endMonthIdx, lastDayOfMonth(y, endMonthIdx));
  }

  const sum = lower.match(/^sum(?:mer)?\s*[- ]?\s*(\d{2,4})$/);
  if (sum) {
    const y = normYear(Number(sum[1]));
    return toIso(y, 8, 30); // end of September
  }

  // Win 25-26 / Win25-26 / Win 2025-26 → 31 Mar of the second year
  const win = lower.match(/^win(?:ter)?\s*[- ]?\s*(\d{2,4})\s*[- ]?\s*(\d{2,4})$/);
  if (win) {
    const y = normYear(Number(win[2]));
    return toIso(y, 2, 31);
  }

  // Month + year shapes: Jan-26, Jan 2026, Mar26, January 2026.
  const monthNames = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  const monthAlias: Record<string, number> = {};
  monthNames.forEach((m, i) => {
    monthAlias[m] = i;
  });
  const monthWord = lower.match(
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*[- ]?\s*(\d{2,4})$/,
  );
  if (monthWord) {
    const mi = monthAlias[monthWord[1]];
    const y = normYear(Number(monthWord[2]));
    if (mi != null) return toIso(y, mi, lastDayOfMonth(y, mi));
  }

  // Pure year: "2026".
  const yearOnly = lower.match(/^(\d{4})$/);
  if (yearOnly) {
    return toIso(Number(yearOnly[1]), 11, 31);
  }

  // YYYY-MM or YYYY/MM.
  const ym = lower.match(/^(\d{4})[-/](\d{1,2})$/);
  if (ym) {
    const y = Number(ym[1]);
    const m = Number(ym[2]) - 1;
    if (m >= 0 && m <= 11) return toIso(y, m, lastDayOfMonth(y, m));
  }

  return null;
}

/**
 * Approximate £ notional of a position based on its entry trade_price and size.
 *
 * Used for like-for-like concentration comparisons across markets where sizes
 * are quoted in incompatible native units (MW, MWh, therm, tco2). This is a
 * coarse relative measure — it uses the trade price (not the live mark), which
 * is fine for concentration purposes since we only care about share of the book.
 *
 * Returns null when the inputs don't allow a defensible conversion.
 */
export function positionNotionalGbp(
  p: Pick<PositionRow, "size" | "trade_price" | "market" | "unit" | "currency" | "instrument_type">,
  gbpPerEur: number = GBP_PER_EUR,
): number | null {
  const size = p.size == null ? null : Math.abs(Number(p.size));
  if (size == null || !Number.isFinite(size) || size === 0) return null;
  const price = p.trade_price;
  if (price == null || !Number.isFinite(price)) return null;
  const it = (p.instrument_type ?? "").toLowerCase();
  if (it === "spark_spread" || it === "dark_spread") {
    return size * price;
  }
  const market = (p.market ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const unit = (p.unit ?? "").toLowerCase();
  const ccy = (p.currency ?? "").toUpperCase();

  // NBP is quoted in pence/therm; £/therm = pence / 100.
  if (market === "nbp" || unit.includes("therm")) {
    return size * (price / 100);
  }
  // EUR-denominated (TTF, DE/FR/Nordic power) → convert to GBP.
  if (
    ccy === "EUR" ||
    market === "ttf" ||
    market === "german_power" ||
    market === "french_power" ||
    market === "nordic_power" ||
    market === "eua"
  ) {
    return size * price * gbpPerEur;
  }
  // Everything else treated as GBP already (GB power £/MWh, UKA £/t, etc.).
  return size * price;
}

export function marketBadge(m: string | null): string {
  if (!m) return "—";
  const map: Record<string, string> = {
    GB_power: "GB POWER",
    NBP: "NBP",
    TTF: "TTF",
    EUA: "EUA",
    UKA: "UKA",
    nordic_power: "NORDIC",
    german_power: "DE POWER",
    french_power: "FR POWER",
    other_gas: "GAS",
    other_power: "POWER",
    other_carbon: "CARBON",
  };
  return map[m] ?? m.replace(/_/g, " ").toUpperCase();
}

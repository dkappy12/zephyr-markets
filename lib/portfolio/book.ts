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

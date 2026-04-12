/** GBP per EUR for rough TTF → £ bridge (matches Markets page). */
export const GBP_PER_EUR = 0.86;
/** Rough MWh → therm conversion factor for NBP p/therm from TTF £/MWh style bridge. */
export const MWH_TO_THERM = 2.931;

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
  ttfGbpMwh: number | null;
  ttfOpenGbpMwh: number | null;
  nbpPencePerTherm: number | null;
  nbpOpenPencePerTherm: number | null;
};

export function ttfToNbpPencePerTherm(ttfEurMwh: number): number {
  const gbpMwh = ttfEurMwh * GBP_PER_EUR;
  return (gbpMwh / MWH_TO_THERM) * 100;
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

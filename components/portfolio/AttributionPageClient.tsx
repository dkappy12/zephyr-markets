"use client";

import {
  bookAlignmentCopy,
  computePremiumAttributionGbp,
  isGbPowerMarket,
  netGbPowerSignedMw,
  parsePhysicalDirection,
  premiumGasGbpPosition,
  premiumRemitGbpPosition,
  premiumWindGbpPosition,
  primaryDriverKey,
  resolveTotalPriceMoveGbpMwh,
  totalTodayPnlGbp,
  type PhysicalPremiumInput,
} from "@/lib/portfolio/attribution";
import {
  formatGbpColored,
  GBP_PER_EUR,
  LivePrices,
  PositionRow,
  ttfToNbpPencePerTherm,
} from "@/lib/portfolio/book";
import { createBrowserClient } from "@/lib/supabase/client";
import type { SignalRow } from "@/lib/signals";
import { format, subDays } from "date-fns";
import { motion } from "framer-motion";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const sectionLabel =
  "text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid";

const BRAND_GREEN = "#1D6B4E";
const TERRACOTTA = "#8B3A3A";
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatSignedGbp(n: number): string {
  const sign = n >= 0 ? "+" : "−";
  const v = Math.abs(n);
  const formatted = v.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${sign}£${formatted}`;
}

/** REMIT body text: "derated by XXX.XMW" */
function parseDeratedMwFromDescription(description: string | null): number | null {
  if (!description) return null;
  const m = description.match(/derated\s+by\s+([\d.]+)\s*MW/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function unplannedSignalImpactGbp(
  parsedMw: number,
  netPowerDeltaMw: number,
): number {
  return parsedMw * 0.5 * (netPowerDeltaMw / 1000);
}

function regimeStyle(regimeRaw: string | null): {
  label: string;
  className: string;
} {
  const r = (regimeRaw ?? "").toUpperCase();
  if (r.includes("GAS") && r.includes("MARGINAL")) {
    return { label: "GAS MARGINAL", className: "text-[#1D6B4E]" };
  }
  if (r.includes("RENEWABLE") && r.includes("DOMINAT")) {
    return {
      label: "RENEWABLE DOMINATED",
      className: "text-amber-700",
    };
  }
  if (r.includes("RENEWABLE")) {
    return { label: r || "RENEWABLE DOMINATED", className: "text-amber-700" };
  }
  return {
    label: regimeRaw?.replace(/\s+/g, " ").toUpperCase() || "—",
    className: "text-ink-mid",
  };
}

type PhysicalRow = {
  calculated_at: string;
  wind_gw: number | null;
  solar_gw: number | null;
  residual_demand_gw: number | null;
  srmc_gbp_mwh: number | null;
  market_price_gbp_mwh: number | null;
  implied_price_gbp_mwh: number | null;
  premium_value: number | null;
  ttf_eur_mwh: number | null;
  remit_mw_lost: number | null;
  normalised_score: number | null;
  direction: string | null;
  regime: string | null;
};

function toPhysicalPremiumInput(row: PhysicalRow | null): PhysicalPremiumInput {
  if (!row) {
    return {
      wind_gw: null,
      solar_gw: null,
      residual_demand_gw: null,
      srmc_gbp_mwh: null,
      market_price_gbp_mwh: null,
      implied_price_gbp_mwh: null,
      premium_value: null,
      remit_mw_lost: null,
    };
  }
  return {
    wind_gw: row.wind_gw,
    solar_gw: row.solar_gw,
    residual_demand_gw: row.residual_demand_gw,
    srmc_gbp_mwh: row.srmc_gbp_mwh,
    market_price_gbp_mwh: row.market_price_gbp_mwh,
    implied_price_gbp_mwh: row.implied_price_gbp_mwh,
    premium_value: row.premium_value,
    remit_mw_lost: row.remit_mw_lost,
  };
}

type PortfolioPnlRow = {
  date: string;
  total_pnl: number | null;
};

export function AttributionPageClient() {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [livePrices, setLivePrices] = useState<LivePrices | null>(null);
  const [physLatest, setPhysLatest] = useState<PhysicalRow | null>(null);
  const [marketIntradayGbpMwh, setMarketIntradayGbpMwh] = useState<number | null>(
    null,
  );
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [pnlHistory, setPnlHistory] = useState<PortfolioPnlRow[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [persistErr, setPersistErr] = useState<string | null>(null);

  const loadPrices = useCallback(async () => {
    const today = utcToday();
    const [mpLatest, mpOpen, gasLatest, gasOpen] = await Promise.all([
      supabase
        .from("market_prices")
        .select("price_gbp_mwh, price_date, settlement_period, market")
        .or("market.eq.N2EX,market.eq.APX")
        .order("price_date", { ascending: false })
        .order("settlement_period", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("market_prices")
        .select("price_gbp_mwh")
        .or("market.eq.N2EX,market.eq.APX")
        .eq("price_date", today)
        .order("settlement_period", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("gas_prices")
        .select("price_eur_mwh, price_time")
        .eq("hub", "TTF")
        .order("price_time", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("gas_prices")
        .select("price_eur_mwh, price_time")
        .eq("hub", "TTF")
        .gte("price_time", `${today}T00:00:00.000Z`)
        .order("price_time", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    const gbp =
      mpLatest.data && typeof mpLatest.data === "object"
        ? Number((mpLatest.data as { price_gbp_mwh?: unknown }).price_gbp_mwh)
        : NaN;
    const gbpOpen =
      mpOpen.data && typeof mpOpen.data === "object"
        ? Number((mpOpen.data as { price_gbp_mwh?: unknown }).price_gbp_mwh)
        : NaN;
    const ttfEur =
      gasLatest.data && typeof gasLatest.data === "object"
        ? Number((gasLatest.data as { price_eur_mwh?: unknown }).price_eur_mwh)
        : NaN;
    const ttfEurOpen =
      gasOpen.data && typeof gasOpen.data === "object"
        ? Number((gasOpen.data as { price_eur_mwh?: unknown }).price_eur_mwh)
        : NaN;

    const ttfGbp = Number.isFinite(ttfEur) ? ttfEur * GBP_PER_EUR : null;
    const ttfOpenGbp = Number.isFinite(ttfEurOpen)
      ? ttfEurOpen * GBP_PER_EUR
      : null;

    setLivePrices({
      gbPowerGbpMwh: Number.isFinite(gbp) ? gbp : null,
      gbPowerOpenGbpMwh: Number.isFinite(gbpOpen) ? gbpOpen : null,
      ttfEurMwh: Number.isFinite(ttfEur) ? ttfEur : null,
      ttfGbpMwh: ttfGbp,
      ttfOpenEurMwh: Number.isFinite(ttfEurOpen) ? ttfEurOpen : null,
      ttfOpenGbpMwh: ttfOpenGbp,
      nbpPencePerTherm:
        Number.isFinite(ttfEur) ? ttfToNbpPencePerTherm(ttfEur) : null,
      nbpOpenPencePerTherm:
        Number.isFinite(ttfEurOpen) ? ttfToNbpPencePerTherm(ttfEurOpen) : null,
    });
  }, [supabase]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    setUserId(uid);

    const today = utcToday();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since30 = format(subDays(new Date(), 30), "yyyy-MM-dd");

    const [
      posRes,
      physLate,
      mpTodayFirst,
      mpTodayLast,
      sigRes,
      histRes,
    ] = await Promise.all([
      uid
        ? supabase
            .from("positions")
            .select("*")
            .eq("user_id", uid)
            .eq("is_closed", false)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as PositionRow[], error: null }),
      supabase
        .from("physical_premium")
        .select(
          "calculated_at, wind_gw, solar_gw, residual_demand_gw, srmc_gbp_mwh, market_price_gbp_mwh, implied_price_gbp_mwh, premium_value, ttf_eur_mwh, remit_mw_lost, normalised_score, direction, regime",
        )
        .order("calculated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("market_prices")
        .select("price_gbp_mwh")
        .or("market.eq.N2EX,market.eq.APX")
        .eq("price_date", today)
        .order("settlement_period", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("market_prices")
        .select("price_gbp_mwh")
        .or("market.eq.N2EX,market.eq.APX")
        .eq("price_date", today)
        .order("settlement_period", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("signals")
        .select(
          "id, type, title, description, direction, source, confidence, created_at, raw_data",
        )
        .gte("created_at", since24h)
        .order("created_at", { ascending: false })
        .limit(200),
      uid
        ? supabase
            .from("portfolio_pnl")
            .select("date, total_pnl")
            .eq("user_id", uid)
            .gte("date", since30)
            .order("date", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (posRes.data) setPositions(posRes.data as PositionRow[]);
    else setPositions([]);

    setPhysLatest((physLate.data as PhysicalRow) ?? null);

    const openP = mpTodayFirst.data
      ? Number(
          (mpTodayFirst.data as { price_gbp_mwh?: unknown }).price_gbp_mwh,
        )
      : NaN;
    const closeP = mpTodayLast.data
      ? Number(
          (mpTodayLast.data as { price_gbp_mwh?: unknown }).price_gbp_mwh,
        )
      : NaN;
    if (Number.isFinite(openP) && Number.isFinite(closeP)) {
      setMarketIntradayGbpMwh(closeP - openP);
    } else {
      setMarketIntradayGbpMwh(null);
    }

    setSignals((sigRes.data ?? []) as SignalRow[]);
    setPnlHistory((histRes.data ?? []) as PortfolioPnlRow[]);

    await loadPrices();
    setLoading(false);
  }, [supabase, loadPrices]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    void loadPrices();
    const t = setInterval(() => void loadPrices(), 120_000);
    return () => clearInterval(t);
  }, [loadPrices]);

  const hasPositions = positions.length > 0;
  const hasGbPower = positions.some((p) => isGbPowerMarket(p));

  const physDir = parsePhysicalDirection(physLatest?.direction ?? null);

  const physicalInput = useMemo(
    () => toPhysicalPremiumInput(physLatest),
    [physLatest],
  );

  const totalPriceMoveGbpMwh = useMemo(
    () =>
      resolveTotalPriceMoveGbpMwh({
        marketIntradayGbpMwh,
        physical: physicalInput,
      }),
    [marketIntradayGbpMwh, physicalInput],
  );

  const premiumAttr = useMemo(
    () =>
      computePremiumAttributionGbp(
        totalPriceMoveGbpMwh,
        physicalInput,
        positions,
      ),
    [totalPriceMoveGbpMwh, physicalInput, positions],
  );

  const windAtt = premiumAttr.windGbp;
  const gasAtt = premiumAttr.gasGbp;
  const remitAtt = premiumAttr.remitGbp;

  const totalPnl = totalTodayPnlGbp(positions, livePrices);
  const residual = totalPnl - windAtt - gasAtt - remitAtt;

  const primary = primaryDriverKey(windAtt, gasAtt, remitAtt, residual);

  const windStackPct = useMemo(() => {
    const w = parseNum(physLatest?.wind_gw) ?? 0;
    const s = parseNum(physLatest?.solar_gw) ?? 0;
    const r = parseNum(physLatest?.residual_demand_gw) ?? 0;
    const d = w + s + r;
    return d > 0 ? (w / d) * 100 : 0;
  }, [physLatest]);

  const gasCostSharePct = useMemo(() => {
    const m = parseNum(physLatest?.market_price_gbp_mwh);
    const sr = parseNum(physLatest?.srmc_gbp_mwh);
    if (m == null || sr == null || m <= 0) return 0;
    return Math.min(100, Math.max(0, (sr / m) * 100));
  }, [physLatest]);

  const remitStressPct = useMemo(() => {
    const rm = parseNum(physLatest?.remit_mw_lost) ?? 0;
    return Math.min(100, (rm / 5000) * 100);
  }, [physLatest]);

  const normScore = parseNum(physLatest?.normalised_score);

  const gbNet = netGbPowerSignedMw(positions);

  const alignmentScore = useMemo(() => {
    if (gbNet.isMixed || normScore == null) return 0;
    if (gbNet.signedMw === 0) return 0;
    const dir = gbNet.signedMw > 0 ? 1 : -1;
    return normScore * dir;
  }, [gbNet, normScore]);

  const alignmentPct = Math.max(
    0,
    Math.min(100, Math.round(50 + alignmentScore * 4.2)),
  );

  const regime = regimeStyle(physLatest?.regime ?? null);

  const bookAlign = bookAlignmentCopy(physDir, positions);

  const scoreLine = useMemo(() => {
    const ns = normScore;
    if (ns == null || !Number.isFinite(ns)) {
      return { text: "—", className: "text-ink-mid" };
    }
    const abs = Math.abs(ns).toFixed(1);
    const sign = ns >= 0 ? "+" : "−";
    const tag =
      physDir === "firming"
        ? "FIRMING"
        : physDir === "softening"
          ? "SOFTENING"
          : "PHYSICAL";
    const cls =
      physDir === "firming"
        ? "text-[#1D6B4E]"
        : physDir === "softening"
          ? "text-[#8B3A3A]"
          : "text-ink";
    return {
      text: `${sign}${abs} ${tag}`,
      className: cls,
    };
  }, [normScore, physDir]);

  const totalFmt = formatGbpColored(totalPnl);

  const absSum =
    Math.abs(windAtt) +
    Math.abs(gasAtt) +
    Math.abs(remitAtt) +
    Math.abs(residual);
  const barPct = (v: number) =>
    absSum > 0 ? Math.round((Math.abs(v) / absSum) * 100) : 0;

  const chartData = pnlHistory
    .map((r) => ({
      d: r.date,
      pnl: Number(r.total_pnl ?? 0),
    }))
    .filter((x) => Number.isFinite(x.pnl));

  const unplannedSignals = useMemo(() => {
    if (!hasGbPower) return [];
    return [...signals]
      .filter((s) => /unplanned/i.test(s.description ?? ""))
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, 5);
  }, [signals, hasGbPower]);

  const gaugeContext = useMemo(() => {
    const r = (physLatest?.regime ?? "").toLowerCase();
    if (r.includes("gas") && r.includes("marginal")) {
      return alignmentScore >= 0
        ? "In a gas-marginal regime, alignment usually means your GB power side is positioned with the marginal cost story."
        : "In a gas-marginal regime, a low score suggests your GB power side may be leaning against the prevailing driver.";
    }
    if (r.includes("renew")) {
      return alignmentScore >= 0
        ? "With renewables dominating, favourable alignment often means your book fits a softer prompt."
        : "Renewable-dominated conditions can punish directional GB power if your book fights the wind-and-solar stack.";
    }
    return "Alignment blends the physical score with your net GB power direction.";
  }, [physLatest?.regime, alignmentScore]);

  useEffect(() => {
    if (!userId || !hasPositions || loading) return;

    const attributionJson = {
      generated_at: new Date().toISOString(),
      total_pnl: totalPnl,
      wind_attribution_gbp: windAtt,
      gas_attribution_gbp: gasAtt,
      remit_attribution_gbp: remitAtt,
      residual_gbp: residual,
      primary_driver: primary,
      total_price_move_gbp_mwh: totalPriceMoveGbpMwh,
      market_intraday_gbp_mwh: marketIntradayGbpMwh,
      premium_model: premiumAttr,
      physical: physLatest,
    };

    const snapshot = positions.map((p) => ({
      id: p.id,
      instrument: p.instrument,
      market: p.market,
      direction: p.direction,
      size: p.size,
      unit: p.unit,
      tenor: p.tenor,
    }));

    void (async () => {
      const row = {
        user_id: userId,
        date: utcToday(),
        total_pnl: totalPnl,
        wind_attribution_gbp: windAtt,
        gas_attribution_gbp: gasAtt,
        remit_attribution_gbp: remitAtt,
        residual_gbp: residual,
        carbon_attribution_gbp: 0,
        primary_driver: primary,
        attribution_json: attributionJson,
        positions_snapshot: snapshot,
      };

      const { error } = await supabase.from("portfolio_pnl").upsert(
        row,
        { onConflict: "user_id,date" },
      );
      if (error) setPersistErr(error.message);
      else setPersistErr(null);
    })();
  }, [
    userId,
    hasPositions,
    loading,
    totalPnl,
    windAtt,
    gasAtt,
    remitAtt,
    residual,
    primary,
    supabase,
    positions,
    physLatest,
    marketIntradayGbpMwh,
    totalPriceMoveGbpMwh,
  ]);

  const bookAlignmentDisplay =
    gbNet.isMixed || gbNet.signedMw === 0
      ? { text: "MIXED — check breakdown", className: "text-ink-mid" }
      : bookAlign;

  return (
    <div className="space-y-10">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Attribution
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          How today&apos;s physical drivers are moving your book.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-ink-mid">Loading attribution…</p>
      ) : !userId ? (
        <p className="text-sm text-ink-mid">Sign in to view attribution.</p>
      ) : !hasPositions ? (
        <div className="flex flex-col items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-16 text-center">
          <p className="font-serif text-xl text-ink">No positions to attribute</p>
          <p className="mt-2 max-w-md text-sm text-ink-mid">
            Import positions in the Book tab to see attribution analysis.
          </p>
        </div>
      ) : (
        <>
          {persistErr ? (
            <p className="text-xs text-[#8B3A3A]" role="status">
              Could not save today&apos;s snapshot: {persistErr}
            </p>
          ) : null}

          {/* Top stats */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-4 border-b-[0.5px] border-ivory-border bg-ivory px-4 py-4 sm:grid-cols-2 lg:grid-cols-4 sm:px-5"
          >
            <div>
              <p className={sectionLabel}>Total P&amp;L today</p>
              <p
                className={`mt-1 text-lg font-semibold tabular-nums ${totalFmt.className}`}
              >
                {totalFmt.text}
              </p>
            </div>
            <div>
              <p className={sectionLabel}>Physical premium score</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${scoreLine.className}`}>
                {scoreLine.text}
              </p>
            </div>
            <div>
              <p className={sectionLabel}>Book alignment</p>
              <p
                className={`mt-1 text-sm font-semibold leading-snug ${bookAlignmentDisplay.className}`}
              >
                {bookAlignmentDisplay.text}
              </p>
            </div>
            <div>
              <p className={sectionLabel}>Regime</p>
              <p
                className={`mt-1 text-sm font-semibold uppercase tracking-wide ${regime.className}`}
              >
                {regime.label}
              </p>
            </div>
          </motion.div>

          {/* Hero attribution */}
          <section>
            <p className={sectionLabel}>P&amp;L attribution</p>
            <h2 className="mt-1 font-serif text-2xl text-ink">
              What moved your book today
            </h2>

            <div className="mt-4 overflow-x-auto rounded-[4px] border-[0.5px] border-ivory-border bg-card">
              <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-ivory-border text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-mid">
                    <th className="px-4 py-3">Driver</th>
                    <th className="px-3 py-3">Impact</th>
                    <th className="px-3 py-3">Direction</th>
                    <th className="px-4 py-3">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      {
                        name: "Wind generation",
                        impact: windAtt,
                        dir: `${windStackPct.toFixed(0)}% stack · ${premiumAttr.windMoveGbpMwh.toFixed(2)} £/MWh`,
                      },
                      {
                        name: "Gas prices (TTF)",
                        impact: gasAtt,
                        dir: `${gasCostSharePct.toFixed(0)}% SRMC vs DA · ${premiumAttr.gasMoveGbpMwh.toFixed(2)} £/MWh`,
                      },
                      {
                        name: "REMIT outages",
                        impact: remitAtt,
                        dir: `${remitStressPct.toFixed(0)}% system stress · ${premiumAttr.remitMoveGbpMwh.toFixed(2)} £/MWh`,
                      },
                      {
                        name: "Residual",
                        impact: residual,
                        dir: "unexplained",
                      },
                    ] as const
                  ).map((row) => {
                    const f = formatGbpColored(row.impact);
                    const pct = barPct(row.impact);
                    const fill = row.impact >= 0 ? BRAND_GREEN : TERRACOTTA;
                    return (
                      <tr
                        key={row.name}
                        className="border-b border-ivory-border/80"
                      >
                        <td className="px-4 py-3 font-semibold text-ink">
                          {row.name}
                        </td>
                        <td className={`px-3 py-3 tabular-nums font-medium ${f.className}`}>
                          {f.text}
                        </td>
                        <td className="px-3 py-3 text-ink-mid">{row.dir}</td>
                        <td className="px-4 py-3">
                          <div className="flex h-2 w-full max-w-[200px] overflow-hidden rounded-sm bg-ivory-dark/80">
                            <div
                              className="h-full transition-all"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: fill,
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-ivory/60">
                    <td className="px-4 py-3 font-semibold text-ink">Total</td>
                    <td
                      className={`px-3 py-3 tabular-nums font-semibold ${totalFmt.className}`}
                    >
                      {totalFmt.text}
                    </td>
                    <td className="px-3 py-3 text-ink-mid">—</td>
                    <td className="px-4 py-3" />
                  </tr>
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={() => setDetailOpen((v) => !v)}
              className="mt-3 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid hover:text-ink"
            >
              {detailOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Expand position detail ▼
            </button>

            {detailOpen ? (
              <div className="mt-4 space-y-4 rounded-[4px] border-[0.5px] border-ivory-border bg-ivory/40 px-4 py-4">
                {positions.map((p) => {
                  const w = premiumWindGbpPosition(
                    p,
                    premiumAttr.windMoveGbpMwh,
                  );
                  const g = premiumGasGbpPosition(
                    p,
                    premiumAttr.gasMoveGbpMwh,
                  );
                  const r = premiumRemitGbpPosition(
                    p,
                    premiumAttr.remitMoveGbpMwh,
                  );
                  const sub = w + g + r;
                  const dir =
                    p.direction === "short" ? "Short" : "Long";
                  return (
                    <div
                      key={p.id}
                      className="border-b border-ivory-border/70 pb-3 last:border-0 last:pb-0"
                    >
                      <p className="font-medium text-ink">
                        {p.instrument ?? "Position"} ({dir}{" "}
                        {p.size ?? "—"} {p.unit ?? ""})
                      </p>
                      <ul className="mt-2 space-y-1 text-[13px] text-ink-mid">
                        {w !== 0 ? (
                          <li>
                            Wind factor:{" "}
                            <span className={formatGbpColored(w).className}>
                              {formatGbpColored(w).text}
                            </span>
                          </li>
                        ) : null}
                        {g !== 0 ? (
                          <li>
                            Gas factor:{" "}
                            <span className={formatGbpColored(g).className}>
                              {formatGbpColored(g).text}
                            </span>
                          </li>
                        ) : null}
                        {r !== 0 ? (
                          <li>
                            REMIT factor:{" "}
                            <span className={formatGbpColored(r).className}>
                              {formatGbpColored(r).text}
                            </span>
                          </li>
                        ) : null}
                        <li className="font-medium text-ink">
                          Subtotal: {formatGbpColored(sub).text}
                        </li>
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>

          {/* Signals */}
          <section>
            <p className={sectionLabel}>Physical signals</p>
            <h2 className="mt-1 font-serif text-xl text-ink">
              Active signals relevant to your positions
            </h2>
            {unplannedSignals.length === 0 ? (
              <p className="mt-3 text-sm text-ink-mid">
                No active REMIT signals directly affecting your current positions.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {unplannedSignals.map((s) => {
                  const parsedMw = parseDeratedMwFromDescription(
                    s.description,
                  );
                  const netMw = gbNet.isMixed ? 0 : gbNet.signedMw;
                  const est =
                    parsedMw != null
                      ? unplannedSignalImpactGbp(parsedMw, netMw)
                      : 0;
                  const estFmt = formatGbpColored(est);
                  const gbPos = positions.find((p) => isGbPowerMarket(p));
                  const anchor =
                    gbPos != null
                      ? `${gbPos.direction === "short" ? "short" : "long"} ${gbPos.instrument ?? "GB power"}`
                      : "book";
                  return (
                    <article
                      key={s.id}
                      className="rounded-[4px] border-[0.5px] border-ivory-border border-l-[2px] border-l-[#1D6B4E] bg-card px-3 py-2.5"
                    >
                      <p className="text-[11px] font-semibold text-ink">
                        {s.title}
                      </p>
                      {parsedMw != null ? (
                        <p className="mt-1 text-[11px] text-ink-mid">
                          {parsedMw.toLocaleString("en-GB", {
                            maximumFractionDigits: 1,
                          })}{" "}
                          MW offline (unplanned)
                        </p>
                      ) : null}
                      <p className="mt-2 border-l-2 border-[#1D6B4E] pl-2 text-[12px] italic leading-snug text-ink-mid">
                        This supports your {anchor} position — estimated{" "}
                        <span className={`not-italic ${estFmt.className}`}>
                          {estFmt.text}
                        </span>{" "}
                        impact
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Gauge */}
          <section>
            <p className={sectionLabel}>Alignment</p>
            <h2 className="mt-1 font-serif text-xl text-ink">
              Book vs physical conditions
            </h2>
            <div className="mt-4 rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-5">
              <div className="relative pt-6">
                <div className="flex justify-between text-[10px] font-medium uppercase tracking-[0.12em] text-ink-mid">
                  <span>Fully bearish</span>
                  <span>Fully bullish</span>
                </div>
                <div className="relative mt-2 h-3 rounded-full bg-gradient-to-r from-[#8B3A3A]/35 via-ivory-dark to-[#1D6B4E]/45">
                  <div
                    className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-ink shadow"
                    style={{ left: `${alignmentPct}%` }}
                    title={`${alignmentPct}%`}
                  />
                </div>
              </div>
              <p className="mt-4 text-sm text-ink-mid">
                Your book is{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {alignmentPct}%
                </span>{" "}
                aligned with current physical signals. {gaugeContext}
              </p>
            </div>
          </section>

          {/* History */}
          <section>
            <p className={sectionLabel}>History</p>
            <h2 className="mt-1 font-serif text-xl text-ink">
              Historical P&amp;L
            </h2>
            {chartData.length === 0 ? (
              <p className="mt-3 text-sm text-ink-mid">
                Historical P&amp;L tracking will appear here as data accumulates.
                Check back tomorrow.
              </p>
            ) : (
              <div className="mt-4 h-[220px] rounded-[4px] border-[0.5px] border-ivory-border bg-card px-2 py-3">
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart
                    data={chartData}
                    margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
                  >
                    <defs>
                      <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor={BRAND_GREEN}
                          stopOpacity={0.35}
                        />
                        <stop
                          offset="100%"
                          stopColor={BRAND_GREEN}
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(44,42,38,0.08)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="d"
                      tick={{ fontSize: 10, fill: "#6b6560" }}
                      tickFormatter={(d) => {
                        try {
                          return format(new Date(String(d)), "d MMM");
                        } catch {
                          return String(d);
                        }
                      }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#6b6560" }}
                      tickFormatter={(v) => `£${v}`}
                    />
                    <Tooltip
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 4,
                        border: "0.5px solid #e8e4dc",
                      }}
                      formatter={(v) => [
                        typeof v === "number"
                          ? formatSignedGbp(v)
                          : String(v ?? "—"),
                        "Total P&L",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="pnl"
                      stroke={BRAND_GREEN}
                      strokeWidth={1.5}
                      fill="url(#pnlGrad)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

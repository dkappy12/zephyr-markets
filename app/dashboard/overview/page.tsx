"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { MetricCard } from "@/components/ui/MetricCard";
import { SignalCard, type SignalCardProps } from "@/components/ui/SignalCard";
import { TopoBackground } from "@/components/ui/TopoBackground";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  dedupeSignalRowsByTitleDescription,
  type SignalRow,
  signalRowToCardProps,
} from "@/lib/signals";

type CardWithId = SignalCardProps & { id: string };

/** 17 GW approximate output at 8 m/s mean wind → linear scale to GW. */
const MS_TO_GW = 17 / 8;

/** Always show sign, one decimal (e.g. +1.8, -0.3, +0.0). */
function formatSignedNormalisedScore(n: number): string {
  const abs = Math.abs(n).toFixed(1);
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return "+0.0";
}

const PREMIUM_DIRECTION_LABEL: Record<string, string> = {
  FIRMING: "Firming",
  SOFTENING: "Softening",
  STABLE: "Stable",
};

/** PostgREST may return numeric columns as number or string. */
function parsePhysicalPremiumScore(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return Number.NaN;
}

/** Age of a DB timestamp vs client clock (for as-of labels). */
function formatDbAge(
  iso: string | null | undefined,
  nowMs: number,
): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function OverviewPageInner() {
  const searchParams = useSearchParams();
  const [billingBannerDismissed, setBillingBannerDismissed] = useState(false);
  const billingParam = searchParams.get("billing");
  const billingDismissKey = useMemo(() => {
    if (!billingParam) return null;
    const sessionId = searchParams.get("checkout_session_id") ?? "";
    return `billing_banner_dismissed:${billingParam}:${sessionId}`;
  }, [billingParam, searchParams]);
  const billingBannerSessionDismissed = useMemo(() => {
    if (!billingDismissKey || typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(billingDismissKey) === "1";
    } catch {
      return false;
    }
  }, [billingDismissKey]);
  const billingBanner =
    !billingBannerDismissed &&
    !billingBannerSessionDismissed &&
    (billingParam === "success" || billingParam === "cancelled")
      ? billingParam
      : null;

  function dismissBillingBanner() {
    setBillingBannerDismissed(true);
    try {
      if (billingDismissKey) {
        window.sessionStorage.setItem(billingDismissKey, "1");
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("billing");
      url.searchParams.delete("checkout_session_id");
      window.history.replaceState({}, "", url.pathname + url.search);
    } catch {
      // ignore
    }
  }

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const relTimeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [preview, setPreview] = useState<CardWithId[]>([]);
  const [remit24h, setRemit24h] = useState<number | null>(null);
  const [windGw, setWindGw] = useState<number | null>(null);
  const [windHistory, setWindHistory] = useState<number[]>([]);
  const [premiumLoading, setPremiumLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [relativeNowMs, setRelativeNowMs] = useState(() => new Date().getTime());
  const [premiumRow, setPremiumRow] = useState<{
    normalised_score: number;
    direction: string;
    implied_price_gbp_mwh: number | null;
    market_price_gbp_mwh: number | null;
  } | null>(null);
  const [n2exPrice, setN2exPrice] = useState<number | null>(null);
  /** Always from latest physical_premium row when present — independent of score parse (feeds N2EX metric). */
  const [premiumMarketTapeGbp, setPremiumMarketTapeGbp] = useState<number | null>(
    null,
  );
  const [ttfPrice, setTtfPrice] = useState<number | null>(null);
  const [regime, setRegime] = useState<string | null>(null);
  const [srmcGbp, setSrmcGbp] = useState<number | null>(null);
  const [residualDemandGw, setResidualDemandGw] = useState<number | null>(null);
  const [windForecastTimeIso, setWindForecastTimeIso] = useState<string | null>(
    null,
  );
  const [premiumCalculatedAtIso, setPremiumCalculatedAtIso] = useState<
    string | null
  >(null);
  const [n2exTapeFootnote, setN2exTapeFootnote] = useState<string | null>(null);
  const [ttfTapeFootnote, setTtfTapeFootnote] = useState<string | null>(null);
  const [solarGw, setSolarGw] = useState<number | null>(null);
  const [solarDatetimeGmt, setSolarDatetimeGmt] = useState<string | null>(null);
  const [signalDelayMinutes, setSignalDelayMinutes] = useState(0);
  const [hasPositions, setHasPositions] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/billing/status")
      .then(async (res) => {
        if (!res.ok) {
          return {
            delay: 0,
          };
        }
        const body = (await res.json()) as {
          entitlements?: {
            signalDelayMinutes?: number;
          };
        };
        return {
          delay: Number(body.entitlements?.signalDelayMinutes ?? 0),
        };
      })
      .then(({ delay }) => {
        if (!active) return;
        setSignalDelayMinutes(Number.isFinite(delay) ? Math.max(0, delay) : 0);
      })
      .catch(() => {
        if (!active) return;
        setSignalDelayMinutes(0);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function checkPositions() {
      const supabase = createBrowserClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!active || !userData.user) return;
      const { count } = await supabase
        .from("positions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userData.user.id)
        .eq("is_closed", false);
      if (!active) return;
      setHasPositions((count ?? 0) > 0);
    }
    void checkPositions();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const supabase = createBrowserClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const delayedCutoffIso = new Date(
      Date.now() - signalDelayMinutes * 60_000,
    ).toISOString();
    const nowIso = new Date().toISOString();

    async function load() {
      setLoading(true);
      const [
        sigRes,
        countRes,
        windRes,
        premiumRes,
        n2exRes,
        ttfRes,
        solarRes,
      ] = await Promise.all([
        supabase
          .from("signals")
          .select(
            "id, type, title, description, direction, source, confidence, created_at, raw_data",
          )
          .lte("created_at", delayedCutoffIso)
          .order("created_at", { ascending: false })
          .limit(32),
        supabase
          .from("signals")
          .select("*", { count: "exact", head: true })
          .eq("type", "remit")
          .gte("created_at", since)
          .lte("created_at", delayedCutoffIso),
        supabase
          .from("weather_forecasts")
          .select("wind_speed_100m, forecast_time")
          .eq("location", "GB")
          .lte("forecast_time", nowIso)
          .order("forecast_time", { ascending: false })
          .limit(12),
        supabase
          .from("physical_premium")
          .select(
            "normalised_score, direction, implied_price_gbp_mwh, market_price_gbp_mwh, calculated_at, regime, srmc_gbp_mwh, residual_demand_gw",
          )
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("market_prices")
          .select("price_gbp_mwh, price_date, settlement_period, market")
          .or("market.eq.N2EX,market.eq.APX")
          .order("price_date", { ascending: false })
          .order("settlement_period", { ascending: false })
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
          .from("solar_outturn")
          .select("solar_mw, datetime_gmt")
          .order("datetime_gmt", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!sigRes.error && sigRes.data) {
        const deduped = dedupeSignalRowsByTitleDescription(
          sigRes.data as SignalRow[],
        ).slice(0, 4);
        setPreview(deduped.map(signalRowToCardProps));
      }
      if (countRes.error) {
        setRemit24h(null);
      } else {
        setRemit24h(countRes.count ?? 0);
      }

      if (!windRes.error && windRes.data) {
        const rows = Array.isArray(windRes.data) ? windRes.data : [];
        const first = rows[0] as Record<string, unknown> | undefined;
        if (first) {
          const w = first.wind_speed_100m;
          const ms =
            typeof w === "number" ? w : w != null ? Number(w) : Number.NaN;
          setWindGw(Number.isFinite(ms) ? ms * MS_TO_GW : null);
          const ft = first.forecast_time;
          setWindForecastTimeIso(
            typeof ft === "string"
              ? ft
              : ft != null
                ? String(ft)
                : null,
          );
          const history: number[] = [];
          for (const row of rows) {
            const r = row as Record<string, unknown>;
            const v = r.wind_speed_100m;
            const m =
              typeof v === "number" ? v : v != null ? Number(v) : Number.NaN;
            if (Number.isFinite(m)) {
              history.push(m * MS_TO_GW);
            }
          }
          setWindHistory(history);
        } else {
          setWindGw(null);
          setWindForecastTimeIso(null);
          setWindHistory([]);
        }
      } else {
        setWindGw(null);
        setWindForecastTimeIso(null);
        setWindHistory([]);
      }

      const nsRaw = premiumRes.data?.normalised_score;
      const score = parsePhysicalPremiumScore(nsRaw);

      function numOrNull(v: unknown): number | null {
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "string" && v.trim() !== "") {
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        }
        return null;
      }

      if (!premiumRes.error && premiumRes.data) {
        const d = premiumRes.data as Record<string, unknown>;
        const dirRaw = d.direction;
        const dir =
          typeof dirRaw === "string" ? dirRaw.trim().toUpperCase() : "";
        const implied = numOrNull(d.implied_price_gbp_mwh);
        const market = numOrNull(d.market_price_gbp_mwh);
        const srmc = numOrNull(d.srmc_gbp_mwh);
        const resGw = numOrNull(d.residual_demand_gw);
        const calcAt = d.calculated_at;
        setPremiumCalculatedAtIso(
          typeof calcAt === "string"
            ? calcAt
            : calcAt != null
              ? String(calcAt)
              : null,
        );
        setPremiumMarketTapeGbp(market);
        if (Number.isFinite(score)) {
          setPremiumRow({
            normalised_score: score,
            direction: dir,
            implied_price_gbp_mwh: implied,
            market_price_gbp_mwh: market,
          });
        } else {
          setPremiumRow(null);
        }
        setRegime(typeof d.regime === "string" && d.regime.trim() !== "" ? d.regime : null);
        setSrmcGbp(srmc);
        setResidualDemandGw(resGw);
      } else {
        setPremiumRow(null);
        setPremiumMarketTapeGbp(null);
        setRegime(null);
        setSrmcGbp(null);
        setResidualDemandGw(null);
        setPremiumCalculatedAtIso(null);
      }

      if (!n2exRes.error && n2exRes.data) {
        const row = n2exRes.data as {
          price_gbp_mwh?: unknown;
          price_date?: unknown;
          settlement_period?: unknown;
          market?: unknown;
        };
        setN2exPrice(numOrNull(row.price_gbp_mwh));
        const pd =
          typeof row.price_date === "string" ? row.price_date : null;
        const sp = row.settlement_period;
        const mk = typeof row.market === "string" ? row.market : "N2EX";
        const spStr =
          sp != null && String(sp).trim() !== "" ? ` · ${String(sp)}` : "";
        setN2exTapeFootnote(
          pd ? `Tape ${mk} · ${pd}${spStr}` : `Tape ${mk}`,
        );
      } else {
        setN2exPrice(null);
        setN2exTapeFootnote(null);
      }

      if (!ttfRes.error && ttfRes.data) {
        const row = ttfRes.data as {
          price_eur_mwh?: unknown;
          price_time?: unknown;
        };
        setTtfPrice(numOrNull(row.price_eur_mwh));
        const pt = row.price_time;
        setTtfTapeFootnote(
          pt != null && String(pt).trim() !== ""
            ? `TTF hub · ${String(pt)}`
            : "TTF hub · EEX",
        );
      } else {
        setTtfPrice(null);
        setTtfTapeFootnote(null);
      }

      if (!solarRes.error && solarRes.data) {
        const sm = solarRes.data.solar_mw;
        const mw =
          typeof sm === "number" ? sm : sm != null ? Number(sm) : Number.NaN;
        setSolarGw(Number.isFinite(mw) ? mw / 1000 : null);
        const dt = solarRes.data.datetime_gmt;
        setSolarDatetimeGmt(
          typeof dt === "string" ? dt : dt != null ? String(dt) : null,
        );
      } else {
        setSolarGw(null);
        setSolarDatetimeGmt(null);
      }
      setPremiumLoading(false);
      setUpdatedAt(new Date());
      setLoading(false);
    }

    void load();
    pollRef.current = setInterval(() => {
      void load();
    }, 180000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [signalDelayMinutes]);

  useEffect(() => {
    relTimeRef.current = setInterval(() => {
      setRelativeNowMs(new Date().getTime());
    }, 30000);
    return () => {
      if (relTimeRef.current) clearInterval(relTimeRef.current);
    };
  }, []);

  const updatedAgoLabel = useMemo(() => {
    if (updatedAt == null) return "—";
    const sec = Math.max(0, Math.floor((relativeNowMs - updatedAt.getTime()) / 1000));
    if (sec < 60) return "Updated just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `Updated ${min} min ago`;
    const hr = Math.floor(min / 60);
    return `Updated ${hr}h ago`;
  }, [updatedAt, relativeNowMs]);

  const impliedPrice = premiumRow?.implied_price_gbp_mwh ?? null;
  const marketPrice = premiumRow?.market_price_gbp_mwh ?? null;
  /** Prefer live tape; then premium card row; then raw market field from same API row if score failed to parse. */
  const n2exDisplayPrice =
    n2exPrice ?? marketPrice ?? premiumMarketTapeGbp;
  /** Always use the live tape price for the gap calculation — never the stale physical_premium.market_price_gbp_mwh */
  const premiumGap =
    impliedPrice != null && n2exDisplayPrice != null
      ? impliedPrice - n2exDisplayPrice
      : null;

  const premiumModelRunLabel = useMemo(() => {
    if (!premiumCalculatedAtIso) return null;
    return `Model run ${formatDbAge(premiumCalculatedAtIso, relativeNowMs)}`;
  }, [premiumCalculatedAtIso, relativeNowMs]);

  const billingBannerCopy =
    billingBanner === "success"
      ? "Thank you — your subscription is updated. Your plan may take a moment to show everywhere."
      : billingBanner === "cancelled"
        ? "Checkout was cancelled. No changes were made to your plan."
        : null;

  const windTrend: "up" | "down" | "flat" | undefined = (() => {
    if (windGw === null || windHistory.length < 3) return undefined;
    const mean =
      windHistory.slice(1).reduce((a, b) => a + b, 0) /
      (windHistory.length - 1);
    if (windGw > mean + 1) return "up";
    if (windGw < mean - 1) return "down";
    return "flat";
  })();

  return (
    <div className="space-y-10">
      {billingBanner != null && billingBannerCopy ? (
        <div
          role="status"
          className={`flex flex-wrap items-start justify-between gap-3 rounded-[4px] border-[0.5px] px-4 py-3 text-sm ${
            billingBanner === "cancelled"
              ? "border-ivory-border bg-ivory text-ink-mid"
              : "border-gold/45 bg-gold/10 text-ink"
          }`}
        >
          <p className="min-w-0 flex-1 leading-relaxed">{billingBannerCopy}</p>
          <button
            type="button"
            onClick={dismissBillingBanner}
            className="shrink-0 rounded-[4px] border-[0.5px] border-ivory-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-mid transition-colors hover:bg-ivory-dark hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="font-serif text-3xl text-ink"
        >
          Overview
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          Physical premium, GB power fundamentals, and the signals that move your
          book today.
        </p>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-light">
        Staleness is per series below. N2EX and TTF are market tape where
        available; wind is forecast-derived (not Elexon outturn).
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="GB WIND (MODEL)"
          value={windGw === null ? "—" : windGw.toFixed(1)}
          unit="GW"
          trend={windTrend}
          footnote={
            windForecastTimeIso
              ? `Forecast step ${formatDbAge(windForecastTimeIso, relativeNowMs)}`
              : "No forecast step"
          }
          hoverDetail={
            <span>
              <span className="block font-medium text-ink">
                Forecast → GW (not BMRS outturn)
              </span>
              <span className="mt-2 block">
                Uses the latest GB weather forecast (100m wind, m/s), scaled to GW
                with a fixed heuristic: 17 GW at 8 m/s mean. For live outturn use
                desk tools — this card is directional context for the premium
                model only.
              </span>
            </span>
          }
        />
        <MetricCard
          label="RESIDUAL DEMAND"
          value={
            residualDemandGw === null ? "—" : residualDemandGw.toFixed(1)
          }
          unit="GW"
          footnote={
            premiumCalculatedAtIso
              ? `Premium model · ${formatDbAge(premiumCalculatedAtIso, relativeNowMs)}`
              : "From physical premium model"
          }
          hoverDetail="Residual demand (GW) from the same physical premium calculation as the score and implied vs market gap — not a TTF leg."
        />
        <MetricCard
          label="N2EX DAY-AHEAD"
          value={
            n2exDisplayPrice == null
              ? "—"
              : `£${n2exDisplayPrice.toFixed(2)}`
          }
          unit="/MWh"
          footnote={n2exTapeFootnote ?? "—"}
          hoverDetail="Day-ahead power from market_prices (N2EX/APX tape). Shown price may match the premium row when tape aligns."
        />
        <MetricCard
          label="REMIT ALERTS"
          value={remit24h === null ? "—" : String(remit24h)}
          unit="last 24h"
          trend={
            remit24h === null
              ? undefined
              : remit24h > 0
                ? "up"
                : "flat"
          }
          footnote="REMIT-type signals in rolling 24h window"
        />
        <MetricCard
          label="TTF (GAS CONTEXT)"
          value={ttfPrice == null ? "—" : `€${ttfPrice.toFixed(2)}`}
          unit="/MWh"
          footnote={ttfTapeFootnote ?? "—"}
          hoverDetail="European gas benchmark — context for interconnect and fuel switching. The physical premium headline is GB power; TTF is not the premium’s primary leg."
        />
        <MetricCard
          label="GB SOLAR (OUTTURN)"
          value={solarGw === null ? "—" : solarGw.toFixed(2)}
          unit="GW"
          footnote={
            solarDatetimeGmt
              ? `Outturn ${formatDbAge(solarDatetimeGmt, relativeNowMs)}`
              : "No recent outturn"
          }
          hoverDetail="Latest GB solar from solar_outturn (MW → GW). Missing if pipeline has no row yet."
        />
      </div>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, delay: 0.05 }}
        className="relative overflow-visible rounded-[4px] border-[0.5px] border-gold/45 bg-card px-6 py-6 text-ink"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[4px]">
          <TopoBackground className="h-full w-full" lineOpacity={0.12} />
        </div>
        <div className="relative z-[1] grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-6">
          <div className="space-y-4 md:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-gold">
                  <span className="inline-flex items-center">
                    Physical premium
                    <span className="group relative ml-1.5 inline-flex shrink-0 align-middle">
                      <span
                        className="cursor-help select-none text-xs font-normal normal-case tracking-normal text-ink-light"
                        aria-label="Physical premium score explained"
                      >
                        ⓘ
                      </span>
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-1/2 z-[9999] mb-1 w-max max-w-[min(100vw-2rem,320px)] -translate-x-1/2 rounded-[6px] border border-[#D4CCBB] bg-[#F5F0E8] px-3 py-[10px] text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-[#3D3D2E] opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-opacity duration-150 group-hover:opacity-100"
                      >
                        <span className="block">
                          The physical premium score measures how far the N2EX day-ahead
                          market has diverged from our model&apos;s physically-implied
                          GB power price (same run as implied £/MWh below).
                        </span>
                        <span className="mt-3 block font-medium">
                          Gap = implied £/MWh − N2EX £/MWh
                        </span>
                        <span className="mt-1 block">
                          Dashes appear if implied, market, or score is missing for
                          that model run.
                        </span>
                        <span className="mt-3 block">
                          Negative = market overpriced vs fundamentals (SOFTENING)
                        </span>
                        <span className="mt-1 block">
                          Positive = market underpriced vs fundamentals (FIRMING)
                        </span>
                        <span className="mt-3 block">
                          ±1 moderate · ±2 significant · ±4 extreme
                        </span>
                        <span className="mt-3 block text-[11px] text-ink-mid">
                          TTF in the sidebar is gas-market context only — not the
                          premium&apos;s primary leg.
                        </span>
                      </span>
                    </span>
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap items-baseline gap-3">
                  <p className="font-serif text-5xl leading-none tabular-nums text-ink">
                    {premiumLoading
                      ? "…"
                      : premiumRow
                        ? formatSignedNormalisedScore(premiumRow.normalised_score)
                        : "--"}
                  </p>
                  {!premiumLoading &&
                    premiumRow &&
                    PREMIUM_DIRECTION_LABEL[premiumRow.direction] && (
                      <span className="inline-flex w-fit items-center rounded-[2px] border-[0.5px] border-gold/50 bg-gold/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-gold">
                        {PREMIUM_DIRECTION_LABEL[premiumRow.direction]}
                      </span>
                    )}
                </div>
                {premiumModelRunLabel ? (
                  <p className="mt-2 font-mono text-[10px] text-ink-light">
                    {premiumModelRunLabel}
                  </p>
                ) : null}
              </div>
            </div>
            <p className="font-mono text-xs text-ink-mid">
              {impliedPrice != null && marketPrice != null && premiumGap != null ? (
                <>
                  Implied £{impliedPrice.toFixed(2)} · N2EX £{marketPrice.toFixed(2)} · Gap
                  £{premiumGap.toFixed(2)}/MWh
                </>
              ) : (
                "Implied · N2EX · Gap —"
              )}
            </p>
            <p className="font-mono text-[10px] text-ink-light">
              SRMC{" "}
              {srmcGbp != null ? `£${srmcGbp.toFixed(2)}/MWh` : "—"} · Regime:{" "}
              {regime != null && regime.trim() !== ""
                ? regime.replace(/-/g, " ")
                : "—"}
            </p>
            <p className="mt-1 font-mono text-[9px] text-ink-light/60 uppercase tracking-[0.12em]">
              Powered by Meridian
            </p>
          </div>
          <div className="space-y-4 border-gold/20 md:border-l md:pl-6">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-gold/60">
                Wind (model)
              </p>
              <p className="mt-1 font-mono text-sm text-ink">
                {windGw != null ? `${windGw.toFixed(1)} GW` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-gold/60">
                Residual demand
              </p>
              <p className="mt-1 font-mono text-sm text-ink">
                {residualDemandGw != null ? `${residualDemandGw.toFixed(1)} GW` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-gold/60">
                TTF (context)
              </p>
              <p className="mt-1 font-mono text-sm text-ink">
                {ttfPrice != null ? `€${ttfPrice.toFixed(2)}` : "—"}
              </p>
              <p className="mt-1 text-[10px] leading-snug text-ink-light">
                European gas benchmark
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-xl text-ink">Signal feed</h2>
            <p className="text-xs text-ink-mid">
              Latest physical drivers with desk relevance.
            </p>
            <p className="mt-1 text-[10px] text-ink-light">{updatedAgoLabel}</p>
            {loading && preview.length > 0 ? (
              <p className="text-[10px] text-ink-light">Refreshing...</p>
            ) : null}
          </div>
          <Link
            href="/dashboard/intelligence/signals"
            className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
          >
            View all signals →
          </Link>
        </div>
        <div className="grid gap-3">
          {preview.length === 0 ? (
            <p className="text-sm text-ink-mid">
              No signals yet. The ingestion pipeline is running.
            </p>
          ) : (
            preview.map(({ id, ...card }) => (
              <SignalCard key={id} {...card} />
            ))
          )}
        </div>
      </section>

      {!hasPositions && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-[4px] border-[0.5px] border-gold/45 bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-gold">
            Portfolio
          </p>
          <p className="mt-2 font-serif text-lg text-ink">
            Import positions for book-native scoring.
          </p>
          <p className="mt-1 text-sm text-ink-mid">
            Upload a curve snapshot or positions file. Zephyr maps signals to
            your exposures.
          </p>
          <Link
            href="/dashboard/portfolio/book"
            className="mt-4 inline-flex h-9 items-center rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors duration-200 hover:bg-ivory-dark"
          >
            Import portfolio
          </Link>
        </motion.div>
      )}
    </div>
  );
}

export default function OverviewPage() {
  return (
    <Suspense fallback={null}>
      <OverviewPageInner />
    </Suspense>
  );
}

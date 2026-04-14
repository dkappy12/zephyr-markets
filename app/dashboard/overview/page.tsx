"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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

const EU_STORAGE_LOCATIONS = ["DE", "FR", "IT", "NL", "AT"] as const;
const EU_LABELS: Record<(typeof EU_STORAGE_LOCATIONS)[number], string> = {
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  NL: "Netherlands",
  AT: "Austria",
};

function formatPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v)}%`;
}

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

export default function OverviewPage() {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const relTimeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [preview, setPreview] = useState<CardWithId[]>([]);
  const [remit24h, setRemit24h] = useState<number | null>(null);
  const [deFullPct, setDeFullPct] = useState<number | null>(null);
  const [euFillByLoc, setEuFillByLoc] = useState<
    Partial<Record<(typeof EU_STORAGE_LOCATIONS)[number], number | null>>
  >({});
  const [windGw, setWindGw] = useState<number | null>(null);
  const [solarGw, setSolarGw] = useState<number | null>(null);
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
  const [ttfPrice, setTtfPrice] = useState<number | null>(null);
  const [regime, setRegime] = useState<string | null>(null);
  const [srmcGbp, setSrmcGbp] = useState<number | null>(null);
  const [residualDemandGw, setResidualDemandGw] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    async function load() {
      setLoading(true);
      const [
        sigRes,
        countRes,
        deStorageRes,
        euStorageRes,
        windRes,
        solarRes,
        premiumRes,
        n2exRes,
        ttfRes,
      ] = await Promise.all([
        supabase
          .from("signals")
          .select(
            "id, type, title, description, direction, source, confidence, created_at, raw_data",
          )
          .order("created_at", { ascending: false })
          .limit(32),
        supabase
          .from("signals")
          .select("*", { count: "exact", head: true })
          .eq("type", "remit")
          .gte("created_at", since),
        supabase
          .from("storage_levels")
          .select("full_pct")
          .eq("location", "DE")
          .order("report_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("storage_levels")
          .select("location, full_pct, report_date")
          .in("location", [...EU_STORAGE_LOCATIONS])
          .order("report_date", { ascending: false })
          .limit(40),
        supabase
          .from("weather_forecasts")
          .select("wind_speed_100m, forecast_time")
          .eq("location", "GB")
          .lte("forecast_time", nowIso)
          .order("forecast_time", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("solar_outturn")
          .select("solar_mw, datetime_gmt")
          .order("datetime_gmt", { ascending: false })
          .limit(1)
          .maybeSingle(),
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
          .select("price_gbp_mwh, price_time")
          .eq("market", "N2EX")
          .order("price_time", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("gas_prices")
          .select("price_eur_mwh, price_time")
          .eq("hub", "TTF")
          .order("price_time", { ascending: false })
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

      if (!deStorageRes.error && deStorageRes.data) {
        const p = deStorageRes.data.full_pct;
        setDeFullPct(
          typeof p === "number" ? p : p != null ? Number(p) : null,
        );
      } else {
        setDeFullPct(null);
      }

      if (!euStorageRes.error && euStorageRes.data?.length) {
        const latest: Partial<
          Record<(typeof EU_STORAGE_LOCATIONS)[number], number | null>
        > = {};
        for (const row of euStorageRes.data) {
          const loc = row.location as (typeof EU_STORAGE_LOCATIONS)[number];
          if (!EU_STORAGE_LOCATIONS.includes(loc) || latest[loc] !== undefined) {
            continue;
          }
          const p = row.full_pct;
          latest[loc] =
            typeof p === "number" ? p : p != null ? Number(p) : null;
        }
        setEuFillByLoc(latest);
      } else {
        setEuFillByLoc({});
      }

      if (!windRes.error && windRes.data) {
        const w = windRes.data.wind_speed_100m;
        const ms =
          typeof w === "number" ? w : w != null ? Number(w) : Number.NaN;
        setWindGw(Number.isFinite(ms) ? ms * MS_TO_GW : null);
      } else {
        setWindGw(null);
      }

      if (!solarRes.error && solarRes.data) {
        const sm = solarRes.data.solar_mw;
        const mw =
          typeof sm === "number" ? sm : sm != null ? Number(sm) : Number.NaN;
        setSolarGw(Number.isFinite(mw) ? mw / 1000 : null);
      } else {
        setSolarGw(null);
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
        setRegime(null);
        setSrmcGbp(null);
        setResidualDemandGw(null);
      }

      if (!n2exRes.error && n2exRes.data) {
        const p = (n2exRes.data as { price_gbp_mwh?: unknown }).price_gbp_mwh;
        setN2exPrice(numOrNull(p));
      } else {
        setN2exPrice(null);
      }

      if (!ttfRes.error && ttfRes.data) {
        const p = (ttfRes.data as { price_eur_mwh?: unknown }).price_eur_mwh;
        setTtfPrice(numOrNull(p));
      } else {
        setTtfPrice(null);
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
  }, []);

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
  const premiumGap =
    impliedPrice != null && marketPrice != null
      ? impliedPrice - marketPrice
      : null;

  return (
    <div className="space-y-10">
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
          Physical premium, system fundamentals, and the signals that move your
          book today.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <MetricCard
            label="GB WIND"
            value={windGw === null ? "—" : windGw.toFixed(1)}
            unit="GW"
            trend={windGw === null ? undefined : "flat"}
          />
          <p className="mt-1 text-xs text-ink-mid">
            Residual demand:{" "}
            {residualDemandGw != null
              ? `${residualDemandGw.toFixed(1)} GW`
              : "—"}
          </p>
        </div>
        <MetricCard
          label="N2EX DAY-AHEAD"
          value={n2exPrice == null ? "—" : `£${n2exPrice.toFixed(2)}`}
          unit="/MWh"
        />
        <MetricCard
          label="TTF NGP"
          value={ttfPrice == null ? "—" : `€${ttfPrice.toFixed(2)}`}
          unit="/MWh"
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
                        className="pointer-events-none absolute bottom-full left-1/2 z-[9999] mb-1 w-max max-w-[280px] -translate-x-1/2 rounded-[6px] border border-[#D4CCBB] bg-[#F5F0E8] px-3 py-[10px] text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-[#3D3D2E] opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-opacity duration-150 group-hover:opacity-100"
                      >
                        <span className="block">
                          The physical premium score measures how far the market price
                          has diverged from our model&apos;s physically-implied price.
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
          </div>
          <div className="space-y-4 border-gold/20 md:border-l md:pl-6">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-gold/60">
                Wind
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
                TTF
              </p>
              <p className="mt-1 font-mono text-sm text-ink">
                {ttfPrice != null ? `€${ttfPrice.toFixed(2)}` : "—"}
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
          className="mt-4 rounded-[4px] border-[0.5px] border-gold/50 bg-ivory px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gold transition-colors duration-200 hover:bg-ivory-dark"
        >
          Import portfolio
        </Link>
      </motion.div>
    </div>
  );
}

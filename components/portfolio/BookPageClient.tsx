"use client";

import { TierGate } from "@/components/billing/TierGate";
import { CsvImportFlow } from "@/components/portfolio/CsvImportFlow";
import { QuickAddModal } from "@/components/portfolio/QuickAddModal";
import {
  ReviewImportOverlay,
  type ReviewItem,
} from "@/components/portfolio/ReviewImportOverlay";
import { createBrowserClient } from "@/lib/supabase/client";
import type { ClassifiedPosition } from "@/lib/portfolio/book";
import {
  DASH_MISSING_HISTORY,
  DASH_MISSING_MARK,
} from "@/lib/portfolio/desk-copy";
import {
  eurMwhPnlToGbp,
  formatGbpColored,
  formatPositionEntryPrice,
  GBP_PER_EUR,
  linearPnl,
  LivePrices,
  marketBadge,
  netDeltaMw,
  netDeltaMwByMarket,
  nbpPnlGbp,
  PositionRow,
  tenorToExpiryDate,
  ttfToNbpPencePerTherm,
  type NetDeltaBucket,
} from "@/lib/portfolio/book";
import { totalTodayPnlGbp } from "@/lib/portfolio/attribution";
import { isSpreadInstrument, spreadMarkGbpMwh } from "@/lib/portfolio/spread-marks";
import { Check, Pencil, Trash2, Wind } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const sectionLabel =
  "text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid";

function netDeltaBucketLabel(bucket: NetDeltaBucket): string {
  switch (bucket) {
    case "GB_POWER":
      return "GB";
    case "TTF":
      return "TTF";
    case "CONTINENTAL":
      return "Continental";
    default:
      return "Other";
  }
}

function formatSignedMw(mw: number): string {
  const abs = Math.abs(mw).toLocaleString("en-GB", { maximumFractionDigits: 1 });
  if (mw > 0) return `+${abs} MW`;
  if (mw < 0) return `−${abs} MW`;
  return "0 MW";
}

function normaliseMarket(value: string | null | undefined):
  | "GB_POWER"
  | "TTF"
  | "NBP"
  | "UKA"
  | "EUA"
  | "OTHER_POWER"
  | "OTHER_GAS"
  | "OTHER" {
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

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcYesterdayYmd(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Live marks for P&amp;L (GB power in £/MWh; NBP in p/th). TTF uses EUR in eurMwhPnlToGbp. */
function pricePoints(
  p: PositionRow,
  lp: LivePrices | null,
  which: "current" | "open",
): number | null {
  if (!lp) return null;
  if (isSpreadInstrument(p)) {
    return spreadMarkGbpMwh(p, lp, which === "current" ? "current" : "open");
  }
  const market = normaliseMarket(p.market);
  if (market === "GB_POWER") {
    return which === "current" ? lp.gbPowerGbpMwh : lp.gbPowerOpenGbpMwh;
  }
  // Non-UK power (Nordic / German / French / etc.) has no mark source wired up
  // yet; return null rather than re-using the GB day-ahead, which would inject
  // a spurious P&L.
  if (market === "OTHER_POWER") return null;
  if (market === "TTF") {
    return which === "current" ? lp.ttfEurMwh : lp.ttfOpenEurMwh;
  }
  if (market === "NBP") {
    return which === "current" ? lp.nbpPencePerTherm : lp.nbpOpenPencePerTherm;
  }
  if (market === "UKA") return lp.ukaGbpPerT ?? null;
  if (market === "EUA") return lp.euaEurPerT ?? null;
  if (market === "OTHER_GAS") {
    const unit = (p.unit ?? "").toLowerCase();
    if (unit.includes("therm")) {
      return which === "current"
        ? lp.nbpPencePerTherm
        : lp.nbpOpenPencePerTherm;
    }
    if ((p.currency ?? "").toUpperCase() === "EUR") {
      return which === "current" ? lp.ttfEurMwh : lp.ttfOpenEurMwh;
    }
    const cur = which === "current" ? lp.ttfGbpMwh : lp.ttfOpenGbpMwh;
    return cur ?? null;
  }
  return null;
}

/** Entry column: always `trade_price` from DB, formatted by market/currency (never live). */
const formatEntryPrice = formatPositionEntryPrice;

/**
 * Numeric version of the current mark in the position's natural units (GBP/MWh,
 * p/therm, EUR/MWh, GBP/tCO2, EUR/tCO2). Returns null when there is no usable
 * mark source — callers must fall back to a sensible default (e.g. leave the
 * input blank rather than reusing the entry price).
 */
function getCurrentMarkNumeric(
  p: PositionRow,
  lp: LivePrices | null,
): number | null {
  if (!lp) return null;
  if (isSpreadInstrument(p)) {
    return spreadMarkGbpMwh(p, lp, "current");
  }
  const market = normaliseMarket(p.market);
  if (market === "GB_POWER") return lp.gbPowerGbpMwh ?? null;
  if (market === "OTHER_POWER") return null;
  if (market === "TTF") return lp.ttfEurMwh ?? null;
  if (market === "NBP") return lp.nbpPencePerTherm ?? null;
  if (market === "UKA") return lp.ukaGbpPerT ?? null;
  if (market === "EUA") return lp.euaEurPerT ?? null;
  if (market === "OTHER_GAS") {
    const unit = (p.unit ?? "").toLowerCase();
    if (unit.includes("therm")) return lp.nbpPencePerTherm ?? null;
    if ((p.currency ?? "").toUpperCase() === "EUR") return lp.ttfEurMwh ?? null;
    return lp.ttfGbpMwh ?? null;
  }
  return null;
}

/** Current column: live marks only (never reuse entry). */
function formatCurrentPrice(p: PositionRow, lp: LivePrices | null): string {
  if (!lp) return "—";
  if (isSpreadInstrument(p)) {
    const v = spreadMarkGbpMwh(p, lp, "current");
    if (v == null) return "—";
    const tag = p.instrument_type?.toLowerCase() === "dark_spread" ? "Dark" : "Spark";
    return `£${v.toFixed(2)}/MWh · ${tag}`;
  }
  const market = normaliseMarket(p.market);
  if (market === "GB_POWER") {
    const v = lp.gbPowerGbpMwh;
    return v != null ? `£${v.toFixed(2)}/MWh` : "—";
  }
  if (market === "OTHER_POWER") return "—";
  if (market === "TTF") {
    const v = lp.ttfEurMwh;
    return v != null ? `€${v.toFixed(2)}/MWh` : "—";
  }
  if (market === "NBP") {
    const v = lp.nbpPencePerTherm;
    return v != null ? `${v.toFixed(2)}p/th` : "—";
  }
  if (market === "UKA") {
    const v = lp?.ukaGbpPerT;
    return v != null ? `£${v.toFixed(2)}/t` : "—";
  }
  if (market === "EUA") {
    const v = lp?.euaEurPerT;
    return v != null ? `€${v.toFixed(2)}/t` : "—";
  }
  if (market === "OTHER_GAS") {
    const unit = (p.unit ?? "").toLowerCase();
    if (unit.includes("therm")) {
      const v = lp.nbpPencePerTherm;
      return v != null ? `${v.toFixed(2)}p/th` : "—";
    }
    if ((p.currency ?? "").toUpperCase() === "EUR") {
      const v = lp.ttfEurMwh;
      return v != null ? `€${v.toFixed(2)}/MWh` : "—";
    }
    const v = lp.ttfGbpMwh;
    return v != null ? `£${v.toFixed(2)}/MWh` : "—";
  }
  return "—";
}

function currentMarkReason(p: PositionRow, lp: LivePrices | null): string | null {
  if (!lp) return "Live market marks are not loaded yet.";
  if (p.trade_price == null || !Number.isFinite(p.trade_price)) {
    return "Trade price is missing, so P&L cannot be computed.";
  }
  const market = normaliseMarket(p.market);
  if (market === "OTHER") return "No mark source configured for this market.";
  if (market === "OTHER_POWER") {
    return "No mark source configured for this market — supported power markets: GB Power (N2EX/APX).";
  }
  if (isSpreadInstrument(p)) {
    if (lp.gbPowerGbpMwh == null || lp.ttfEurMwh == null) {
      return "Clean/dark spread needs GB power and TTF marks.";
    }
    if (lp.gbPowerOpenGbpMwh == null || lp.ttfOpenEurMwh == null) {
      return "Missing on-day N2EX or TTF open for intraday P&L on spreads.";
    }
    return null;
  }
  if (market === "GB_POWER") {
    return lp.gbPowerGbpMwh == null ? "Missing GB power market mark." : null;
  }
  if (market === "TTF") {
    return lp.ttfEurMwh == null ? "Missing TTF market mark." : null;
  }
  if (market === "NBP") {
    return lp.nbpPencePerTherm == null ? "Missing NBP market mark." : null;
  }
  if (market === "OTHER_GAS") {
    const unit = (p.unit ?? "").toLowerCase();
    if (unit.includes("therm") && lp.nbpPencePerTherm == null) {
      return "Missing NBP gas mark for therm-based position.";
    }
    if ((p.currency ?? "").toUpperCase() === "EUR" && lp.ttfEurMwh == null) {
      return "Missing TTF gas mark for EUR position.";
    }
    if (lp.ttfGbpMwh == null) return "Missing gas mark for this position.";
  }
  return null;
}

function hasMarkSource(p: PositionRow, lp: LivePrices | null): boolean {
  if (!lp) return false;
  if (isSpreadInstrument(p)) {
    return (
      lp.gbPowerGbpMwh != null &&
      lp.ttfEurMwh != null &&
      spreadMarkGbpMwh(p, lp, "current") != null
    );
  }
  const market = normaliseMarket(p.market);
  if (market === "GB_POWER") return lp.gbPowerGbpMwh != null;
  if (market === "OTHER_POWER") return false;
  if (market === "TTF") return lp.ttfEurMwh != null;
  if (market === "NBP") return lp.nbpPencePerTherm != null;
  if (market === "UKA") return lp.ukaGbpPerT != null;
  if (market === "EUA") return lp.euaGbpPerT != null;
  if (market === "OTHER_GAS") return lp.ttfEurMwh != null || lp.nbpPencePerTherm != null;
  return false;
}

const NO_MARK_SOURCE_TITLE =
  "No mark source available for this instrument — P&L cannot be calculated.\nSupported markets: GB Power, TTF, NBP, UKA, EUA.";

export function BookPageClient() {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [livePrices, setLivePrices] = useState<LivePrices | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "ok" | "err";
  } | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [editPos, setEditPos] = useState<PositionRow | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [keeping, setKeeping] = useState<ReviewItem[]>([]);
  const [discarding, setDiscarding] = useState<ReviewItem[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [closeModal, setCloseModal] = useState<PositionRow | null>(null);
  const [closePrice, setClosePrice] = useState("");
  const [closeDate, setCloseDate] = useState(utcToday());
  const [emailOpen, setEmailOpen] = useState(false);
  const [billingChecked, setBillingChecked] = useState(false);
  const [portfolioEnabled, setPortfolioEnabled] = useState(false);
  const [currentTier, setCurrentTier] = useState<"free" | "pro" | "team" | null>(
    null,
  );
  const [exportLoading, setExportLoading] = useState<
    null | "positions" | "pnl" | "signals"
  >(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/status")
      .then((r) => r.json())
      .then(
        (body: {
          entitlements?: { portfolioEnabled?: boolean };
          effectiveTier?: string;
        }) => {
          setPortfolioEnabled(body.entitlements?.portfolioEnabled ?? false);
          const t = body.effectiveTier;
          setCurrentTier(t === "pro" || t === "team" ? t : "free");
          setBillingChecked(true);
        },
      )
      .catch(() => {
        setPortfolioEnabled(false);
        setCurrentTier("free");
        setBillingChecked(true);
      });
  }, []);

  const showToast = useCallback((message: string, type: "ok" | "err") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const downloadExport = useCallback(
    async (type: "positions" | "pnl" | "signals") => {
      setExportError(null);
      setExportLoading(type);
      try {
        const res = await fetch(`/api/portfolio/export?type=${type}`);
        const ct = res.headers.get("content-type") ?? "";
        if (!res.ok) {
          if (ct.includes("application/json")) {
            const j = (await res.json()) as { error?: string };
            throw new Error(j.error ?? `Export failed (${res.status})`);
          }
          throw new Error(`Export failed (${res.status})`);
        }
        const blob = await res.blob();
        const cd = res.headers.get("Content-Disposition");
        const match = cd?.match(/filename="([^"]+)"/);
        const filename = match?.[1] ?? `export-${type}.csv`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        setExportError(e instanceof Error ? e.message : "Export failed");
      } finally {
        setExportLoading(null);
      }
    },
    [],
  );

  const loadPositions = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    setUserId(uid);
    if (!uid) {
      setPositions([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("positions")
      .select("*")
      .eq("user_id", uid)
      .eq("is_closed", false)
      .order("created_at", { ascending: false });
    if (error) {
      showToast(error.message, "err");
      setPositions([]);
    } else {
      setPositions((data ?? []) as PositionRow[]);
    }
    setLoading(false);
  }, [supabase, showToast]);

  const loadPrices = useCallback(async () => {
    const today = utcToday();
    const yday = utcYesterdayYmd();
    const [
      mpLatest,
      mpOpen,
      gasLatest,
      gasOpen,
      fxLatest,
      ukaLatest,
      euaLatest,
      ukaPrevRow,
      euaPrevRow,
    ] = await Promise.all([
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
      supabase
        .from("fx_rates")
        .select("rate, rate_date")
        .eq("base", "EUR")
        .eq("quote", "GBP")
        .order("rate_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("carbon_prices")
        .select("price_gbp_per_t, price_eur_per_t, price_date")
        .eq("hub", "UKA")
        .order("price_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("carbon_prices")
        .select("price_gbp_per_t, price_eur_per_t, price_date")
        .eq("hub", "EUA")
        .order("price_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("carbon_prices")
        .select("price_gbp_per_t, price_date")
        .eq("hub", "UKA")
        .eq("price_date", yday)
        .maybeSingle(),
      supabase
        .from("carbon_prices")
        .select("price_eur_per_t, price_date")
        .eq("hub", "EUA")
        .eq("price_date", yday)
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

    const fxData = fxLatest.data;
    const liveFxRate =
      fxData != null &&
      typeof fxData === "object" &&
      "rate" in fxData &&
      fxData.rate != null
        ? Number((fxData as { rate: unknown }).rate)
        : GBP_PER_EUR;
    const hasLiveFx =
      fxData != null &&
      typeof fxData === "object" &&
      "rate" in fxData &&
      fxData.rate != null &&
      Number.isFinite(Number((fxData as { rate: unknown }).rate));
    const gbpPerEur = Number.isFinite(liveFxRate) ? liveFxRate : GBP_PER_EUR;
    const fxRateDate =
      hasLiveFx &&
      fxData != null &&
      typeof fxData === "object" &&
      "rate_date" in fxData
        ? String((fxData as { rate_date: unknown }).rate_date ?? "")
        : null;
    const gbpPerEurAgeDays = fxRateDate
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(`${fxRateDate}T00:00:00.000Z`).getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : undefined;

    const ttfGbp = Number.isFinite(ttfEur) ? ttfEur * gbpPerEur : null;
    const ttfOpenGbp = Number.isFinite(ttfEurOpen)
      ? ttfEurOpen * gbpPerEur
      : null;

    const ukaGbp = ukaLatest.data
      ? Number((ukaLatest.data as { price_gbp_per_t?: unknown }).price_gbp_per_t)
      : NaN;
    const euaEur = euaLatest.data
      ? Number((euaLatest.data as { price_eur_per_t?: unknown }).price_eur_per_t)
      : NaN;
    const euaGbp = euaLatest.data
      ? Number((euaLatest.data as { price_gbp_per_t?: unknown }).price_gbp_per_t)
      : NaN;
    const ukaPrevGbp = ukaPrevRow.data
      ? Number((ukaPrevRow.data as { price_gbp_per_t?: unknown }).price_gbp_per_t)
      : NaN;
    const euaPrevEur = euaPrevRow.data
      ? Number((euaPrevRow.data as { price_eur_per_t?: unknown }).price_eur_per_t)
      : NaN;

    setLivePrices({
      gbPowerGbpMwh: Number.isFinite(gbp) ? gbp : null,
      gbPowerOpenGbpMwh: Number.isFinite(gbpOpen) ? gbpOpen : null,
      ttfEurMwh: Number.isFinite(ttfEur) ? ttfEur : null,
      ttfGbpMwh: ttfGbp,
      ttfOpenEurMwh: Number.isFinite(ttfEurOpen) ? ttfEurOpen : null,
      ttfOpenGbpMwh: ttfOpenGbp,
      nbpPencePerTherm:
        Number.isFinite(ttfEur) ? ttfToNbpPencePerTherm(ttfEur, gbpPerEur) : null,
      nbpOpenPencePerTherm:
        Number.isFinite(ttfEurOpen)
          ? ttfToNbpPencePerTherm(ttfEurOpen, gbpPerEur)
          : null,
      gbpPerEur,
      gbpPerEurIsFallback: !hasLiveFx,
      gbpPerEurAgeDays,
      ukaGbpPerT: Number.isFinite(ukaGbp) ? ukaGbp : null,
      euaEurPerT: Number.isFinite(euaEur) ? euaEur : null,
      euaGbpPerT: Number.isFinite(euaGbp) ? euaGbp : null,
      ukaGbpPerTPrev: Number.isFinite(ukaPrevGbp) ? ukaPrevGbp : null,
      euaEurPerTPrev: Number.isFinite(euaPrevEur) ? euaPrevEur : null,
    });
  }, [supabase]);

  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);

  useEffect(() => {
    void loadPrices();
    const t = setInterval(() => void loadPrices(), 120_000);
    return () => clearInterval(t);
  }, [loadPrices]);

  const stats = useMemo(() => {
    const net = netDeltaMw(positions);
    const netByMarket = netDeltaMwByMarket(positions);
    const markets = new Set(
      positions.map((p) => p.market).filter(Boolean),
    ).size;
    const latest =
      positions.length === 0
        ? null
        : positions.reduce((a, b) =>
            a.created_at > b.created_at ? a : b,
          );
    const todayPnl = livePrices ? totalTodayPnlGbp(positions, livePrices) : null;
    const todayPnlFmt =
      todayPnl != null && Number.isFinite(todayPnl)
        ? formatGbpColored(todayPnl)
        : null;
    return {
      net,
      netByMarket,
      openCount: positions.length,
      markets,
      bookUpdated: latest?.created_at ?? null,
      todayPnl: todayPnlFmt,
    };
  }, [positions, livePrices]);

  function handleClassified(payload: {
    headers: string[];
    rows: Record<string, unknown>[];
    classified: ClassifiedPosition[];
  }) {
    const k: ReviewItem[] = [];
    const d: ReviewItem[] = [];
    payload.classified.forEach((c, i) => {
      const item: ReviewItem = {
        ...c,
        _key: `row-${i}-${c.instrument ?? i}`,
      };
      if (c.keep) k.push(item);
      else d.push(item);
    });
    setKeeping(k);
    setDiscarding(d);
    setReviewOpen(true);
  }

  async function runCsvImport() {
    if (!userId || keeping.length === 0) return;
    setImportBusy(true);
    try {
      const payload = keeping.map((item) => ({
        direction: item.direction,
        instrument: item.instrument ?? "Unknown",
        instrument_type: item.instrument_type ?? "other_energy",
        market: item.market ?? "other_power",
        size: item.size ?? 0,
        unit: item.unit ?? "MW",
        tenor: item.tenor,
        trade_price: item.trade_price,
        currency: item.currency,
        expiry_date: item.expiry_date ?? tenorToExpiryDate(item.tenor),
        entry_date: item.entry_date ?? utcToday(),
        source: "csv",
        notes: null,
        is_hypothetical: false,
        is_closed: false,
        raw_csv_row: JSON.stringify(item.original_row ?? {}),
      }));
      const resp = await fetch("/api/portfolio/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload, dryRun: false }),
      });
      const body = (await resp.json().catch(() => ({}))) as {
        code?: string;
        error?: string;
        details?: string;
        rejects?: Array<{ index: number; error: string }>;
      };
      if (!resp.ok) {
        if (body.code === "VALIDATION_FAILED" && Array.isArray(body.rejects)) {
          const first = body.rejects[0];
          throw new Error(
            `Import rejected ${body.rejects.length} row(s). First issue: row ${first.index + 1} - ${first.error}`,
          );
        }
        if (body.code === "RATE_LIMITED") {
          throw new Error("Import rate limit reached. Wait a minute and retry.");
        }
        throw new Error(body.error ?? body.details ?? "Import failed");
      }
      showToast(`${keeping.length} positions imported successfully`, "ok");
      setReviewOpen(false);
      setKeeping([]);
      setDiscarding([]);
      await loadPositions();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Import failed", "err");
    } finally {
      setImportBusy(false);
    }
  }

  function moveToKeeping(item: ReviewItem) {
    setDiscarding((prev) => prev.filter((x) => x._key !== item._key));
    setKeeping((prev) => [...prev, { ...item, keep: true, discard_reason: null }]);
  }

  function removeKeeping(key: string) {
    const item = keeping.find((x) => x._key === key);
    if (!item) return;
    setKeeping((prev) => prev.filter((x) => x._key !== key));
    setDiscarding((prev) => [
      ...prev,
      {
        ...item,
        keep: false,
        discard_reason: "Removed by user before import",
      },
    ]);
  }

  async function clearAllPositions() {
    if (!userId) return;
    if (
      !window.confirm(
        "Clear all open positions in your book? This cannot be undone.",
      )
    ) {
      return;
    }
    const resp = await fetch("/api/portfolio/positions/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "open" }),
    });
    const body = (await resp.json().catch(() => ({}))) as { error?: string };
    if (!resp.ok) showToast(body.error ?? "Could not clear book", "err");
    else {
      showToast("Book cleared", "ok");
      await loadPositions();
    }
  }

  async function deletePosition(id: string) {
    if (!userId) return;
    if (!window.confirm("Delete this position? This cannot be undone.")) return;
    const resp = await fetch(`/api/portfolio/positions/${id}`, {
      method: "DELETE",
    });
    const body = (await resp.json().catch(() => ({}))) as { error?: string };
    if (!resp.ok) {
      const mapped =
        body.error === "Position not found or you do not have access."
          ? "Position not found or already removed."
          : body.error ?? "Could not delete position";
      showToast(mapped, "err");
    }
    else {
      showToast("Position deleted", "ok");
      await loadPositions();
    }
  }

  async function submitClose() {
    if (!userId || !closeModal) return;
    const cp = Number(closePrice);
    if (!Number.isFinite(cp)) {
      showToast("Enter a close price", "err");
      return;
    }
    const resp = await fetch("/api/portfolio/positions/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: closeModal.id,
        close_price: cp,
        close_date: closeDate,
      }),
    });
    const body = (await resp.json().catch(() => ({}))) as { error?: string };
    if (!resp.ok) {
      const mapped =
        body.error ===
        "Position not found, already closed, or you do not have access."
          ? "Position is already closed or no longer available."
          : body.error ?? "Could not close position";
      showToast(mapped, "err");
    }
    else {
      showToast("Position closed", "ok");
      setCloseModal(null);
      await loadPositions();
    }
  }

  const hasPositions = positions.length > 0;

  if (!billingChecked) return null;

  if (!portfolioEnabled) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-20 text-center">
        <p className="font-serif text-2xl text-ink">Portfolio requires Pro</p>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-mid">
          Track positions, monitor P&L in real time, and receive personalised
          morning brief touchpoints. Upgrade to unlock the full portfolio.
        </p>
        <Link
          href="/dashboard/settings?tab=plan"
          className="mt-6 inline-flex items-center rounded-[4px] bg-ink px-5 py-2.5 text-sm font-medium text-ivory transition-colors hover:bg-ink/90"
        >
          Upgrade to Pro →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-serif text-3xl text-ink"
          >
            Book
          </motion.h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-mid">
            Open positions, curve points, and hedge gaps. This is what physical
            premium and attribution run on.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors duration-200 hover:bg-ivory-dark"
          >
            Import CSV
          </button>
          <button
            type="button"
            onClick={() => {
              setEditPos(null);
              setQuickOpen(true);
            }}
            className="rounded-[4px] border-[0.5px] border-ink bg-transparent px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors duration-200 hover:bg-ivory-dark/50"
          >
            Quick add
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-ink-mid">Loading book…</p>
      ) : !userId ? (
        <p className="text-sm text-ink-mid">Sign in to manage positions.</p>
      ) : !hasPositions ? (
        <div className="flex flex-col items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-16 text-center">
          <Wind className="mx-auto h-14 w-14 text-ink-mid/40" strokeWidth={1} />
          <p className="mt-6 font-serif text-2xl text-ink">Your book is empty</p>
          <p className="mt-2 max-w-md text-sm text-ink-mid">
            Import a CSV from your execution platform or add positions manually to
            start book-native P&amp;L attribution.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink hover:bg-ivory-dark"
            >
              Import CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setEditPos(null);
                setQuickOpen(true);
              }}
              className="rounded-[4px] border-[0.5px] border-ink bg-ink px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#FDFBF7] hover:opacity-90"
            >
              Quick add
            </button>
          </div>
          <p className="mt-6 text-[11px] text-ink-light">
            Supported: Trayport, ICE, Bloomberg TOMS, Marex, and any standard CSV
            format
          </p>
        </div>
      ) : (
        <>
          {livePrices?.gbpPerEurIsFallback ||
          (livePrices?.gbpPerEurAgeDays != null &&
            livePrices.gbpPerEurAgeDays > 3) ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-[4px] border-[0.5px] border-amber-700/30 bg-amber-50/60 px-4 py-3"
              role="status"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-900">
                Stale FX
              </p>
              <p className="mt-1 text-sm text-amber-900">
                {livePrices.gbpPerEurIsFallback
                  ? `Using hardcoded fallback EUR→GBP = ${GBP_PER_EUR.toFixed(4)} — no rows in fx_rates.`
                  : `EUR→GBP rate is ${livePrices.gbpPerEurAgeDays} days old.`}{" "}
                TTF £ marks, EUA £ bridges, and gas attribution may be slightly
                off until the FX loader catches up.
              </p>
            </motion.div>
          ) : null}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap items-end gap-x-8 gap-y-3 border-b-[0.5px] border-ivory-border bg-ivory px-4 py-3 sm:px-5"
          >
            <div>
              <p className={sectionLabel}>Net delta</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                {stats.net.label}
              </p>
              {stats.netByMarket.length > 1 ? (
                <p
                  className="mt-1 text-[10px] leading-snug text-ink-light"
                  title="MW-unit positions only (gas in therms excluded). Split by market family so GB / TTF / Continental power aren't silently combined."
                >
                  {stats.netByMarket
                    .map((b) => `${netDeltaBucketLabel(b.bucket)} ${formatSignedMw(b.mw)}`)
                    .join(" · ")}
                </p>
              ) : null}
            </div>
            <div>
              <p className={sectionLabel}>Today P&amp;L</p>
              <p
                className={`mt-1 text-lg font-semibold tabular-nums ${
                  stats.todayPnl?.className ?? "text-ink"
                }`}
                title="Aggregated from priced positions only. Rows without a mark source are excluded."
              >
                {stats.todayPnl?.text ?? "—"}
              </p>
            </div>
            <div>
              <p className={sectionLabel}>Open positions</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                {stats.openCount}
              </p>
            </div>
            <div>
              <p className={sectionLabel}>Markets exposed</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                {stats.markets}
              </p>
            </div>
            <div>
              <p className={sectionLabel}>Book updated</p>
              <p className="mt-1 text-sm font-medium tabular-nums text-ink">
                {stats.bookUpdated
                  ? new Date(stats.bookUpdated).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </p>
            </div>
            <div className="ml-auto flex items-end">
              <button
                type="button"
                onClick={() => void clearAllPositions()}
                className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-light underline-offset-2 hover:text-[#8B3A3A] hover:underline"
              >
                Clear book
              </button>
            </div>
          </motion.div>

          <div className="overflow-x-auto rounded-[4px] border-[0.5px] border-ivory-border bg-card">
            <table className="w-full min-w-[960px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-ivory-border text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-mid">
                  <th className="px-4 py-3">Instrument</th>
                  <th className="px-3 py-3">Market</th>
                  <th className="px-3 py-3">Dir</th>
                  <th className="px-3 py-3">Size</th>
                  <th className="px-3 py-3">Tenor</th>
                  <th className="px-3 py-3">Entry price</th>
                  <th className="px-3 py-3">Current</th>
                  <th className="px-3 py-3">Today P&amp;L</th>
                  <th className="px-3 py-3">Total P&amp;L</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const market = normaliseMarket(p.market);
                  const isNbp = market === "NBP";
                  const isTtf = market === "TTF";
                  const cur = pricePoints(p, livePrices, "current");
                  const opn = pricePoints(p, livePrices, "open");
                  const lp = livePrices;

                  let total: number | null = null;
                  let today: number | null = null;

                  if (isNbp) {
                    const mark = lp?.nbpPencePerTherm ?? null;
                    const open = lp?.nbpOpenPencePerTherm ?? null;
                    total = nbpPnlGbp(p.direction, p.trade_price, mark, p.size);
                    if (mark != null && open != null) {
                      today = nbpPnlGbp(p.direction, open, mark, p.size);
                    }
                  } else if (isTtf && lp) {
                    const curE = lp.ttfEurMwh;
                    const opE = lp.ttfOpenEurMwh;
                    total = eurMwhPnlToGbp(
                      p.direction,
                      p.trade_price,
                      curE,
                      p.size,
                      lp.gbpPerEur,
                    );
                    if (curE != null && opE != null) {
                      today = eurMwhPnlToGbp(
                        p.direction,
                        opE,
                        curE,
                        p.size,
                        lp.gbpPerEur,
                      );
                    }
                  } else if (market === "EUA" && lp) {
                    // EUA marks are EUR/t, entry defaults to EUR. Convert via
                    // live FX so the £ display doesn't silently show EUR.
                    total = eurMwhPnlToGbp(
                      p.direction,
                      p.trade_price,
                      lp.euaEurPerT ?? null,
                      p.size,
                      lp.gbpPerEur,
                    );
                    if (
                      lp.euaEurPerT != null &&
                      lp.euaEurPerTPrev != null
                    ) {
                      today = eurMwhPnlToGbp(
                        p.direction,
                        lp.euaEurPerTPrev,
                        lp.euaEurPerT,
                        p.size,
                        lp.gbpPerEur,
                      );
                    } else {
                      today = null;
                    }
                  } else if (market === "UKA" && lp) {
                    // UKA marks are already GBP/t with GBP entries — linearPnl gives £ directly.
                    total = linearPnl(
                      p.direction,
                      p.trade_price,
                      lp.ukaGbpPerT ?? null,
                      p.size,
                    );
                    if (lp.ukaGbpPerT != null && lp.ukaGbpPerTPrev != null) {
                      today = linearPnl(
                        p.direction,
                        lp.ukaGbpPerTPrev,
                        lp.ukaGbpPerT,
                        p.size,
                      );
                    } else {
                      today = null;
                    }
                  } else if (market === "OTHER_GAS" && lp) {
                    const unit = (p.unit ?? "").toLowerCase();
                    const currency = (p.currency ?? "").toUpperCase();
                    if (unit.includes("therm")) {
                      // Entry and mark are p/th, size is therms → pence, /100 for £.
                      total = nbpPnlGbp(
                        p.direction,
                        p.trade_price,
                        lp.nbpPencePerTherm ?? null,
                        p.size,
                      );
                      const openPth = lp.nbpOpenPencePerTherm ?? null;
                      const markPth = lp.nbpPencePerTherm ?? null;
                      today =
                        openPth != null && markPth != null
                          ? nbpPnlGbp(p.direction, openPth, markPth, p.size)
                          : null;
                    } else if (currency === "EUR") {
                      // Entry and mark are EUR/MWh, size is MW → EUR, × FX for £.
                      total = eurMwhPnlToGbp(
                        p.direction,
                        p.trade_price,
                        lp.ttfEurMwh,
                        p.size,
                        lp.gbpPerEur,
                      );
                      const opE = lp.ttfOpenEurMwh;
                      const curE = lp.ttfEurMwh;
                      today =
                        opE != null && curE != null
                          ? eurMwhPnlToGbp(
                              p.direction,
                              opE,
                              curE,
                              p.size,
                              lp.gbpPerEur,
                            )
                          : null;
                    } else {
                      // Default: entry and mark are already GBP/MWh → £ direct.
                      total = linearPnl(p.direction, p.trade_price, cur, p.size);
                      today =
                        opn != null && cur != null
                          ? linearPnl(p.direction, opn, cur, p.size)
                          : null;
                    }
                  } else {
                    // OTHER_POWER and genuinely unclassified markets: no mark,
                    // `cur` will be null, linearPnl returns null safely.
                    total = linearPnl(p.direction, p.trade_price, cur, p.size);
                    today =
                      opn != null && cur != null
                        ? linearPnl(p.direction, opn, cur, p.size)
                        : null;
                  }

                  const hasMark = hasMarkSource(p, livePrices);
                  const curReason = currentMarkReason(p, livePrices);
                  const tFmt =
                    hasMark && total != null ? formatGbpColored(total) : null;
                  const tdFmt =
                    hasMark && today != null ? formatGbpColored(today) : null;
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-ivory-border/80 transition-colors hover:bg-ivory-dark/40"
                    >
                      <td className="px-4 py-3 font-medium text-ink">
                        {p.instrument ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-ink-mid">
                        {marketBadge(p.market)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            p.direction === "short"
                              ? "bg-[#8B3A3A]/15 text-[#8B3A3A]"
                              : "bg-[#1D6B4E]/15 text-[#1D6B4E]"
                          }`}
                        >
                          {p.direction === "short" ? "SHORT" : "LONG"}
                        </span>
                      </td>
                      <td className="px-3 py-3 tabular-nums text-ink-mid">
                        {p.size ?? "—"} {p.unit ?? ""}
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-3 text-ink-mid">
                        {p.tenor ?? "—"}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-ink-mid">
                        {formatEntryPrice(p)}
                      </td>
                      <td
                        className="px-3 py-3 tabular-nums"
                        title={
                          !hasMark
                            ? NO_MARK_SOURCE_TITLE
                            : curReason ??
                              (formatCurrentPrice(p, livePrices) === "—"
                                ? DASH_MISSING_MARK
                                : undefined)
                        }
                      >
                        {hasMarkSource(p, livePrices) ? (
                          formatCurrentPrice(p, livePrices)
                        ) : (
                          <span className="rounded-[3px] bg-[#92400E]/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#92400E]">
                            No mark source
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-3 tabular-nums ${tdFmt?.className ?? ""}`}
                        title={
                          !hasMark
                            ? NO_MARK_SOURCE_TITLE
                            : today == null
                              ? curReason ?? DASH_MISSING_HISTORY
                              : undefined
                        }
                      >
                        {tdFmt?.text ?? "—"}
                      </td>
                      <td
                        className={`px-3 py-3 tabular-nums ${tFmt?.className ?? ""}`}
                        title={
                          !hasMark
                            ? NO_MARK_SOURCE_TITLE
                            : total == null
                              ? curReason ?? DASH_MISSING_MARK
                              : undefined
                        }
                      >
                        {tFmt?.text ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            title="Edit"
                            onClick={() => {
                              setEditPos(p);
                              setQuickOpen(true);
                            }}
                            className="rounded p-1.5 text-ink-mid hover:bg-ivory-dark hover:text-ink"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Close"
                            onClick={() => {
                              setCloseModal(p);
                              const mark = getCurrentMarkNumeric(p, livePrices);
                              setClosePrice(mark != null ? String(mark) : "");
                              setCloseDate(utcToday());
                            }}
                            className="rounded p-1.5 text-ink-mid hover:bg-ivory-dark hover:text-ink"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            onClick={() => void deletePosition(p.id)}
                            className="rounded p-1.5 text-ink-mid hover:bg-[#8B3A3A]/10 hover:text-[#8B3A3A]"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <TierGate
        requiredTier="team"
        currentTier={currentTier}
        featureName="Data export"
        description="Download your positions, P&L history, and signals as CSV. Team plan only."
        mockup={
          <div className="space-y-3 px-4 py-5 sm:px-5">
            <div className="h-2.5 w-28 rounded bg-ink/10" />
            <div className="h-3 max-w-xl rounded bg-ink/8" />
            <div className="flex flex-wrap gap-2">
              <div className="h-9 min-w-[120px] flex-1 rounded-[4px] border-[0.5px] border-ivory-border bg-card" />
              <div className="h-9 min-w-[120px] flex-1 rounded-[4px] border-[0.5px] border-ivory-border bg-card" />
              <div className="h-9 min-w-[120px] flex-1 rounded-[4px] border-[0.5px] border-ivory-border bg-card" />
            </div>
          </div>
        }
      >
        <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-5 sm:px-5">
          <p className={sectionLabel}>Data export</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-mid">
            Download your positions, P&L history, and signals as CSV. Team plan only.
          </p>
          {exportError ? (
            <p className="mt-2 text-xs text-[#8B3A3A]" role="alert">
              {exportError}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={exportLoading !== null}
              onClick={() => void downloadExport("positions")}
              className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors duration-200 hover:bg-ivory-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportLoading === "positions"
                ? "Exporting…"
                : "Export positions"}
            </button>
            <button
              type="button"
              disabled={exportLoading !== null}
              onClick={() => void downloadExport("pnl")}
              className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors duration-200 hover:bg-ivory-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportLoading === "pnl" ? "Exporting…" : "Export P&L history"}
            </button>
            <button
              type="button"
              disabled={exportLoading !== null}
              onClick={() => void downloadExport("signals")}
              className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors duration-200 hover:bg-ivory-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportLoading === "signals"
                ? "Exporting…"
                : "Export signals (90d)"}
            </button>
          </div>
        </div>
      </TierGate>

      <div className="rounded-[6px] border-[0.5px] border-ivory-border bg-card px-5 py-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
          Auto-update your book
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-mid">
          Connect the email address that receives your trade confirmations. Zephyr
          will automatically parse new trades and update your book.
        </p>
        <button
          type="button"
          onClick={() => setEmailOpen(true)}
          className="mt-4 rounded-[4px] border border-[#1D6B4E] bg-transparent px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#1D6B4E] hover:bg-[#1D6B4E]/10"
        >
          Connect broker email →
        </button>
      </div>

      <CsvImportFlow
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onClassified={handleClassified}
      />

      {userId ? (
        <QuickAddModal
          open={quickOpen}
          onClose={() => {
            setQuickOpen(false);
            setEditPos(null);
          }}
          editPosition={editPos}
          onSaved={() => void loadPositions()}
          onToast={showToast}
        />
      ) : null}

      <ReviewImportOverlay
        open={reviewOpen}
        keeping={keeping}
        discarding={discarding}
        onMoveToKeeping={moveToKeeping}
        onRemoveKeeping={removeKeeping}
        onImport={() => void runCsvImport()}
        importing={importBusy}
        onCancel={() => {
          setReviewOpen(false);
          setKeeping([]);
          setDiscarding([]);
        }}
      />

      {closeModal ? (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-ink/25 px-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-[6px] border border-[#D4CCBB] bg-[#F5F0E8] p-6 shadow-lg">
            <h3 className="font-serif text-lg text-ink">Close position</h3>
            <p className="mt-1 text-xs text-ink-mid">{closeModal.instrument}</p>
            <div className="mt-4 space-y-3">
              <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
                Close price
                <input
                  type="number"
                  step="any"
                  value={closePrice}
                  onChange={(e) => setClosePrice(e.target.value)}
                  className="mt-1 w-full rounded-[4px] border border-[#D4CCBB] bg-card px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
                Close date
                <input
                  type="date"
                  value={closeDate}
                  onChange={(e) => setCloseDate(e.target.value)}
                  className="mt-1 w-full rounded-[4px] border border-[#D4CCBB] bg-card px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloseModal(null)}
                className="rounded-[4px] border border-[#D4CCBB] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitClose()}
                className="rounded-[4px] border border-ink bg-ink px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#FDFBF7]"
              >
                Close position
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {emailOpen ? (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-ink/25 px-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-[6px] border border-[#D4CCBB] bg-[#F5F0E8] p-6 shadow-lg">
            <h3 className="font-serif text-lg text-ink">Broker email</h3>
            <p className="mt-3 text-sm leading-relaxed text-ink-mid">
              Gmail parsing and automatic book updates are coming soon. Join the
              waitlist to get early access when we ship this integration.
            </p>
            <button
              type="button"
              onClick={() => setEmailOpen(false)}
              className="mt-6 rounded-[4px] border border-ink bg-ink px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#FDFBF7]"
            >
              OK
            </button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          className={`fixed bottom-6 right-6 z-[100] rounded-[6px] border px-4 py-3 text-sm shadow-lg ${
            toast.type === "ok"
              ? "border-[#1D6B4E] bg-[#F5F0E8] text-ink"
              : "border-[#8B3A3A] bg-[#F5F0E8] text-[#8B3A3A]"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

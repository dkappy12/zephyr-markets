"use client";

import { CsvImportFlow } from "@/components/portfolio/CsvImportFlow";
import { QuickAddModal } from "@/components/portfolio/QuickAddModal";
import {
  ReviewImportOverlay,
  type ReviewItem,
} from "@/components/portfolio/ReviewImportOverlay";
import { createBrowserClient } from "@/lib/supabase/client";
import type { ClassifiedPosition } from "@/lib/portfolio/book";
import {
  eurMwhPnlToGbp,
  formatGbpColored,
  GBP_PER_EUR,
  linearPnl,
  LivePrices,
  marketBadge,
  netDeltaMw,
  nbpPnlGbp,
  PositionRow,
  ttfToNbpPencePerTherm,
} from "@/lib/portfolio/book";
import { Check, Pencil, Trash2, Wind } from "lucide-react";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";

const sectionLabel =
  "text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid";

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Live marks for P&amp;L (GB power in £/MWh; NBP in p/th). TTF uses EUR in eurMwhPnlToGbp. */
function pricePoints(
  p: PositionRow,
  lp: LivePrices | null,
  which: "current" | "open",
): number | null {
  if (!lp) return null;
  const m = (p.market ?? "").toLowerCase().replace(/\s/g, "_");
  if (m === "gb_power") {
    return which === "current" ? lp.gbPowerGbpMwh : lp.gbPowerOpenGbpMwh;
  }
  if (m === "ttf") {
    return null;
  }
  if (m === "nbp") {
    return which === "current" ? lp.nbpPencePerTherm : lp.nbpOpenPencePerTherm;
  }
  if (m === "uka" || m === "eua") return null;
  return null;
}

/** Entry column: always `trade_price` from DB, formatted by market/currency (never live). */
function formatEntryPrice(p: PositionRow): string {
  if (p.trade_price == null || !Number.isFinite(p.trade_price)) return "—";
  const m = (p.market ?? "").toLowerCase().replace(/\s/g, "_");
  const u = (p.unit ?? "").toLowerCase();
  const ccy = (p.currency ?? "").toUpperCase();
  if (m === "nbp" || u.includes("therm")) {
    return `${p.trade_price.toFixed(2)}p/th`;
  }
  if (
    ccy === "EUR" ||
    m === "ttf" ||
    m === "german_power" ||
    m === "french_power" ||
    m === "nordic_power"
  ) {
    return `€${p.trade_price.toFixed(2)}/MWh`;
  }
  return `£${p.trade_price.toFixed(2)}`;
}

/** Current column: live marks only (never reuse entry). */
function formatCurrentPrice(p: PositionRow, lp: LivePrices | null): string {
  if (!lp) return "—";
  const m = (p.market ?? "").toLowerCase().replace(/\s/g, "_");
  if (m === "uka" || m === "eua") return "—";
  if (m === "gb_power") {
    const v = lp.gbPowerGbpMwh;
    return v != null ? `£${v.toFixed(2)}` : "—";
  }
  if (m === "ttf") {
    const v = lp.ttfEurMwh;
    return v != null ? `€${v.toFixed(2)}/MWh` : "—";
  }
  if (m === "nbp") {
    const v = lp.nbpPencePerTherm;
    return v != null ? `${v.toFixed(2)}p/th` : "—";
  }
  return "—";
}

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

  const showToast = useCallback((message: string, type: "ok" | "err") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

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
    const [
      mpLatest,
      mpOpen,
      gasLatest,
      gasOpen,
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
    const markets = new Set(
      positions.map((p) => p.market).filter(Boolean),
    ).size;
    const latest =
      positions.length === 0
        ? null
        : positions.reduce((a, b) =>
            a.created_at > b.created_at ? a : b,
          );
    return {
      net,
      openCount: positions.length,
      markets,
      bookUpdated: latest?.created_at ?? null,
    };
  }, [positions]);

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
      for (const item of keeping) {
        const row = {
          user_id: userId,
          direction: item.direction,
          instrument: item.instrument ?? "Unknown",
          instrument_type: item.instrument_type ?? "other_energy",
          market: item.market ?? "other_power",
          size: item.size ?? 0,
          unit: item.unit ?? "MW",
          tenor: item.tenor,
          trade_price: item.trade_price,
          currency: item.currency,
          expiry_date: item.expiry_date,
          entry_date: item.entry_date ?? utcToday(),
          source: "csv",
          notes: null,
          is_hypothetical: false,
          is_closed: false,
          raw_csv_row: JSON.stringify(item.original_row ?? {}),
        };
        const { error } = await supabase.from("positions").insert(row);
        if (error) throw error;
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
        "Delete all positions in your book? This cannot be undone.",
      )
    ) {
      return;
    }
    const { error } = await supabase
      .from("positions")
      .delete()
      .eq("user_id", userId);
    if (error) showToast(error.message, "err");
    else {
      showToast("Book cleared", "ok");
      await loadPositions();
    }
  }

  async function deletePosition(id: string) {
    if (!userId) return;
    if (!window.confirm("Delete this position? This cannot be undone.")) return;
    const { error } = await supabase
      .from("positions")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) showToast(error.message, "err");
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
    const { error } = await supabase
      .from("positions")
      .update({
        is_closed: true,
        close_price: cp,
        close_date: closeDate,
      })
      .eq("id", closeModal.id)
      .eq("user_id", userId);
    if (error) showToast(error.message, "err");
    else {
      showToast("Position closed", "ok");
      setCloseModal(null);
      await loadPositions();
    }
  }

  const hasPositions = positions.length > 0;

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
                  const mlow = (p.market ?? "").toLowerCase().replace(/\s/g, "_");
                  const isNbp = mlow === "nbp";
                  const isTtf = mlow === "ttf";
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
                    );
                    if (curE != null && opE != null) {
                      today = eurMwhPnlToGbp(p.direction, opE, curE, p.size);
                    }
                  } else {
                    total = linearPnl(p.direction, p.trade_price, cur, p.size);
                    today =
                      opn != null && cur != null
                        ? linearPnl(p.direction, opn, cur, p.size)
                        : null;
                  }

                  const curCell =
                    mlow === "uka" ? (
                    <span title="Live UKA feed coming soon" className="cursor-help">
                      —
                    </span>
                  ) : mlow === "eua" ? (
                    <span title="Live EUA feed coming soon" className="cursor-help">
                      —
                    </span>
                  ) : (
                    formatCurrentPrice(p, livePrices)
                  );
                  const tFmt =
                    total != null ? formatGbpColored(total) : null;
                  const tdFmt =
                    today != null ? formatGbpColored(today) : null;
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
                      <td className="px-3 py-3 tabular-nums">{curCell}</td>
                      <td
                        className={`px-3 py-3 tabular-nums ${tdFmt?.className ?? ""}`}
                      >
                        {tdFmt?.text ?? "—"}
                      </td>
                      <td
                        className={`px-3 py-3 tabular-nums ${tFmt?.className ?? ""}`}
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
                              setClosePrice(
                                p.trade_price != null
                                  ? String(p.trade_price)
                                  : "",
                              );
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

      <div className="rounded-[6px] border border-[#D4CCBB] bg-transparent px-5 py-5">
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
          userId={userId}
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

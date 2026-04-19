"use client";

import { ManuscriptMarginalia } from "@/components/ui/ManuscriptMarginalia";
import { startStripeSubscriptionCheckout } from "@/lib/billing/start-stripe-checkout";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  formatReliabilityConfidenceDesk,
  reliabilityConfidenceFromBriefAgeHours,
} from "@/lib/reliability/contract";
import { parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

type BriefArticle = {
  headline: string;
  snippet: string;
  author: string | null;
  publication: string;
  url: string;
  thumbnail_url: string | null;
  published_date?: string | null;
};

type BriefRow = {
  generated_at: string;
  executive_summary: string | null;
  overnight_summary: string | null;
  weather_watch: string | null;
  one_risk: string | null;
  watch_list: string | null;
  book_touchpoints: string | null;
  /** Snapshot from brief generation; prefer live `physical_premium` for score/direction when calling personalise. */
  physical_premium_score?: number | null;
  articles: BriefArticle[] | null;
};

type OpenPosition = {
  instrument: string;
  market: string;
  direction: string;
  size: number;
  unit: string;
  trade_price: number | null;
};

function parseWatchList(watchList: string | null): string[] {
  if (!watchList?.trim()) return [];
  return watchList
    .split("•")
    .map((s) => s.trim().replace(/^[-–—]\s*/, "").trim())
    .filter(Boolean);
}

const sectionLabelClass =
  "text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light";

const bookTouchpointsLabelClass =
  "text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-light";

function formatDirectionLabel(direction: string): string {
  const d = direction.trim().toLowerCase();
  if (d === "long") return "Long";
  if (d === "short") return "Short";
  if (!d) return "";
  return direction.charAt(0).toUpperCase() + direction.slice(1);
}

function formatSizeForTouchpointSummary(size: number, unit: string): string {
  const u = unit.trim().toLowerCase();
  const abs = Number.isFinite(size) ? Math.abs(size) : 0;
  if (u === "therm" && abs >= 1000) {
    return abs.toLocaleString("en-GB");
  }
  return String(abs);
}

/** One line for the footer: "Long 50 MW … · Short 25,000 therm …" */
function personalisationSummaryLine(positions: OpenPosition[]): string {
  return positions
    .map((p) => {
      const dir = formatDirectionLabel(p.direction);
      const sz = formatSizeForTouchpointSummary(p.size, p.unit);
      const unit = p.unit.trim();
      const inst = p.instrument.trim();
      return `${dir} ${sz} ${unit} ${inst}`.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean)
    .join(" · ");
}

/** Full brief snapshot for same browser session — instant revisit, no duplicate personalise. */
const BRIEF_SESSION_PREFIX = "zephyr:briefSession:v1:";

type BriefSessionSnapshot = {
  generatedAt: string;
  row: BriefRow;
  bookTouchpointText: string | null;
};

function briefSessionKey(userId: string) {
  return `${BRIEF_SESSION_PREFIX}${userId}`;
}

function loadBriefSessionSnapshot(userId: string): BriefSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(briefSessionKey(userId));
    if (!raw) return null;
    const o = JSON.parse(raw) as BriefSessionSnapshot;
    if (typeof o.generatedAt !== "string" || !o.row) return null;
    return o;
  } catch {
    return null;
  }
}

function saveBriefSessionSnapshot(
  userId: string,
  row: BriefRow,
  bookTouchpointText: string | null,
) {
  if (typeof window === "undefined") return;
  const ga = row.generated_at?.trim() ?? "";
  if (!ga) return;
  try {
    sessionStorage.setItem(
      briefSessionKey(userId),
      JSON.stringify({
        generatedAt: ga,
        row,
        bookTouchpointText,
      } satisfies BriefSessionSnapshot),
    );
  } catch {
    // quota / private mode
  }
}

/** One personalised paragraph per user per morning brief (`generated_at`); avoids refetch on every navigation. */
const BOOK_TOUCHPOINTS_CACHE_PREFIX = "zephyr:briefBookTouchpoints:v1:";

function loadCachedBookTouchpoints(
  userId: string,
  generatedAt: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(
      `${BOOK_TOUCHPOINTS_CACHE_PREFIX}${userId}:${generatedAt}`,
    );
    if (!raw) return null;
    const o = JSON.parse(raw) as { text?: unknown };
    return typeof o.text === "string" && o.text.trim() !== ""
      ? o.text.trim()
      : null;
  } catch {
    return null;
  }
}

function saveCachedBookTouchpoints(
  userId: string,
  generatedAt: string,
  text: string,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `${BOOK_TOUCHPOINTS_CACHE_PREFIX}${userId}:${generatedAt}`,
      JSON.stringify({ text }),
    );
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Bare domains (e.g. indexbox.com/foo) must be https — otherwise the browser
 * treats them as paths on the current origin.
 */
const BLOCKED_ARTICLE_HOSTS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.edu",
  "test.com",
  "localhost",
]);

function normalizeArticleHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const u = raw.trim();
  if (!u) return null;
  let resolved: string;
  const lower = u.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    resolved = u;
  } else if (u.startsWith("//")) {
    resolved = `https:${u}`;
  } else {
    const host = u.split("/")[0] ?? "";
    if (host.includes(".") && !host.startsWith(".")) {
      resolved = `https://${u.replace(/^\/+/, "")}`;
    } else {
      return null;
    }
  }
  try {
    const host = new URL(resolved).hostname.toLowerCase().split(":")[0];
    if (BLOCKED_ARTICLE_HOSTS.has(host)) return null;
    if (host.endsWith(".example.com") || host.endsWith(".example.org")) {
      return null;
    }
  } catch {
    return null;
  }
  return resolved;
}

const snippetClampStyle: CSSProperties = {
  fontSize: "13px",
  color: "#6b6b5a",
  lineHeight: 1.5,
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

/**
 * Further reading: include an article only if it has its own remote thumbnail URL.
 * Missing or invalid http(s) URLs are excluded — those articles are not shown.
 */
function hasDisplayableThumbnail(article: BriefArticle): boolean {
  const t = article.thumbnail_url?.trim();
  if (!t) return false;
  try {
    const u = new URL(t.startsWith("//") ? `https:${t}` : t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  } catch {
    return false;
  }
  return true;
}

function FurtherReadingArticleCard({ article }: { article: BriefArticle }) {
  const [imgFailed, setImgFailed] = useState(false);
  const href = normalizeArticleHref(article.url);
  const thumb = article.thumbnail_url?.trim();

  const cardClass =
    "flex gap-4 rounded-lg border border-stone-200 p-4 transition-all duration-150 hover:border-stone-400 hover:shadow-md";

  /** Parent filters with {@link hasDisplayableThumbnail}; if the image still fails to load, hide the whole card. */
  if (!hasDisplayableThumbnail(article) || imgFailed) return null;

  const content = (
    <>
      <div className="relative h-32 w-56 shrink-0 overflow-hidden rounded-lg sm:h-36 sm:w-64">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumb}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setImgFailed(true)}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-start justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-light">
            {article.publication}
          </span>
          <span className="font-mono text-[10px] text-ink-light shrink-0">
            {article.published_date || ""}
          </span>
        </div>
        <p
          className="font-serif text-[16px] leading-snug text-ink mb-1.5"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {article.headline}
        </p>
        <p className="text-[11px] leading-relaxed text-ink-mid" style={snippetClampStyle}>
          {article.snippet}
        </p>
      </div>
    </>
  );

  if (!href) {
    return (
      <div
        className={`${cardClass} cursor-default opacity-90`}
        title="Missing or invalid article URL"
      >
        {content}
      </div>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        textDecoration: "none",
        color: "inherit",
        cursor: "pointer",
      }}
      className={cardClass}
    >
      {content}
    </a>
  );
}

export default function BriefPage() {
  // Example output (third-person observation): "Today's extreme softening conditions create direct headwinds for the long 50 MW GB Power Q3 2026 Baseload position entered at £89.50 — with the market trading £35/MWh above the physically-implied price, mean reversion risk is elevated. The short 25,000 therm NBP Winter 2026 and short 10 MW TTF Q4 2026 positions are well-positioned given renewable dominance suppressing gas demand; the TTF at €50/MWh with temperature-suppressed heating load supports the short gas bias."
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<BriefRow | null>(null);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [touchpointPositions, setTouchpointPositions] = useState<OpenPosition[]>([]);
  const [bookTouchpointText, setBookTouchpointText] = useState<string | null>(null);
  const [bookTouchpointLoading, setBookTouchpointLoading] = useState(false);
  const [bookTouchpointError, setBookTouchpointError] = useState<string | null>(null);
  const [briefDelayMinutes, setBriefDelayMinutes] = useState(0);
  const [portfolioEnabled, setPortfolioEnabled] = useState<boolean | null>(null);
  const [touchpointCheckoutLoading, setTouchpointCheckoutLoading] = useState(false);

  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) {
        setTouchpointCheckoutLoading(false);
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/billing/status")
      .then(async (res) => {
        if (!active) return;
        if (!res.ok) {
          setBriefDelayMinutes(0);
          setPortfolioEnabled(false);
          return;
        }
        const body = (await res.json()) as {
          entitlements?: { signalDelayMinutes?: number; portfolioEnabled?: boolean };
          effectiveTier?: string;
        };
        const delay = Number(body.entitlements?.signalDelayMinutes ?? 0);
        setBriefDelayMinutes(Number.isFinite(delay) ? Math.max(0, delay) : 0);
        setPortfolioEnabled(body.entitlements?.portfolioEnabled ?? false);
      })
      .catch(() => {
        if (!active) return;
        setBriefDelayMinutes(0);
        setPortfolioEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const supabase = createBrowserClient();

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const sessionSnap = user ? loadBriefSessionSnapshot(user.id) : null;
      if (sessionSnap?.row) {
        setRow(sessionSnap.row);
        if (sessionSnap.bookTouchpointText) {
          setBookTouchpointText(sessionSnap.bookTouchpointText);
          setBookTouchpointLoading(false);
        }
        setLoading(false);
      }

      const briefCutoffIso =
        briefDelayMinutes > 0
          ? new Date(Date.now() - briefDelayMinutes * 60_000).toISOString()
          : null;
      const briefQuery = supabase
        .from("brief_entries")
        .select("*")
        .order("generated_at", { ascending: false })
        .limit(1);
      const [briefRes, posRes, ppRes] = await Promise.all([
        briefCutoffIso
          ? briefQuery.lte("generated_at", briefCutoffIso).maybeSingle()
          : briefQuery.maybeSingle(),
        user
          ? supabase
              .from("positions")
              .select("instrument,market,direction,size,unit,trade_price")
              .eq("user_id", user.id)
              .eq("is_closed", false)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("physical_premium")
          .select(
            "normalised_score, direction, implied_price_gbp_mwh, residual_demand_gw, srmc_gbp_mwh, remit_mw_lost, market_price_gbp_mwh, premium_value, regime",
          )
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const latestBrief = !briefRes.error && briefRes.data
        ? (briefRes.data as BriefRow)
        : null;
      const latestGa = latestBrief?.generated_at?.trim() ?? "";

      if (latestBrief) {
        if (!sessionSnap || sessionSnap.generatedAt !== latestGa) {
          setRow(latestBrief);
        }
      } else {
        setRow(null);
      }

      const open = ((posRes.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
        instrument: String(p.instrument ?? ""),
        market: String(p.market ?? ""),
        direction: String(p.direction ?? ""),
        size: Number(p.size ?? 0),
        unit: String(p.unit ?? ""),
        trade_price:
          p.trade_price == null || !Number.isFinite(Number(p.trade_price))
            ? null
            : Number(p.trade_price),
      }));
      setPositions(open);
      const focus = [...open]
        .filter((p) => p.instrument.trim() !== "")
        .sort((a, b) => Math.abs(b.size) - Math.abs(a.size))
        .slice(0, 8);
      setTouchpointPositions(focus);
      if (open.length === 0) {
        setBookTouchpointText(null);
        setBookTouchpointError(null);
      }

      let touchFinal: string | null = null;

      if (!briefRes.error && briefRes.data && open.length > 0 && user) {
        const b = briefRes.data as BriefRow;
        const generatedAt = b.generated_at?.trim() ?? "";
        const cachedLs =
          generatedAt !== ""
            ? loadCachedBookTouchpoints(user.id, generatedAt)
            : null;
        const sessionTouchSameBrief =
          sessionSnap?.generatedAt === generatedAt
            ? sessionSnap.bookTouchpointText
            : null;

        if (cachedLs) {
          setBookTouchpointText(cachedLs);
          setBookTouchpointLoading(false);
          touchFinal = cachedLs;
        } else if (sessionTouchSameBrief) {
          setBookTouchpointText(sessionTouchSameBrief);
          setBookTouchpointLoading(false);
          touchFinal = sessionTouchSameBrief;
          if (generatedAt !== "") {
            saveCachedBookTouchpoints(user.id, generatedAt, sessionTouchSameBrief);
          }
        } else {
          setBookTouchpointLoading(true);
          setBookTouchpointError(null);
          try {
            const {
              data: { session },
            } = await supabase.auth.getSession();
            const headers: Record<string, string> = {
              "content-type": "application/json",
            };
            if (session?.access_token) {
              headers.Authorization = `Bearer ${session.access_token}`;
            }
            const pp = ppRes.data as
              | {
                  normalised_score?: number | null;
                  direction?: string | null;
                  implied_price_gbp_mwh?: number | null;
                  residual_demand_gw?: number | null;
                  srmc_gbp_mwh?: number | null;
                  remit_mw_lost?: number | null;
                  market_price_gbp_mwh?: number | null;
                  premium_value?: number | null;
                  regime?: string | null;
                }
              | null
              | undefined;
            const scoreFromPp =
              pp?.normalised_score != null && Number.isFinite(Number(pp.normalised_score))
                ? Number(pp.normalised_score)
                : null;
            const scoreFromBrief =
              b.physical_premium_score != null &&
              Number.isFinite(Number(b.physical_premium_score))
                ? Number(b.physical_premium_score)
                : null;
            const normalisedScore = scoreFromPp ?? scoreFromBrief ?? 0;
            const premiumDirection =
              (typeof pp?.direction === "string" && pp.direction.trim() !== ""
                ? pp.direction
                : null) ?? "STABLE";
            const resp = await fetch("/api/brief/personalise", {
              method: "POST",
              headers,
              credentials: "same-origin",
              body: JSON.stringify({
                overnight_summary: b.overnight_summary ?? b.executive_summary ?? "",
                one_risk: b.one_risk ?? "",
                normalised_score: normalisedScore,
                direction: premiumDirection,
                regime: pp?.regime ?? null,
                residual_demand: pp?.residual_demand_gw ?? null,
                implied_price: pp?.implied_price_gbp_mwh ?? null,
                market_price: pp?.market_price_gbp_mwh ?? null,
                gap: pp?.premium_value ?? null,
                srmc: pp?.srmc_gbp_mwh ?? null,
                remit_mw: pp?.remit_mw_lost ?? null,
                positions: focus,
              }),
            });
            const body = (await resp.json()) as { text?: string; error?: string };
            if (resp.ok && typeof body.text === "string" && body.text.trim() !== "") {
              const t = body.text.trim();
              setBookTouchpointText(t);
              touchFinal = t;
              if (generatedAt !== "") {
                saveCachedBookTouchpoints(user.id, generatedAt, t);
              }
            } else {
              setBookTouchpointError(
                typeof body.error === "string" && body.error.trim() !== ""
                  ? body.error
                  : "Touchpoints are temporarily unavailable.",
              );
            }
          } catch {
            setBookTouchpointError("Touchpoints are temporarily unavailable.");
          } finally {
            setBookTouchpointLoading(false);
          }
        }
      } else {
        setBookTouchpointLoading(false);
      }

      if (user && latestBrief) {
        saveBriefSessionSnapshot(
          user.id,
          latestBrief,
          open.length === 0 ? null : touchFinal,
        );
      }

      setLoading(false);
    }

    load();
  }, [briefDelayMinutes]);

  const articles: BriefArticle[] = Array.isArray(row?.articles)
    ? row!.articles!
    : [];
  const articlesWithThumbnails = articles.filter(hasDisplayableThumbnail);

  const headerTime =
    row?.generated_at != null
      ? formatInTimeZone(parseISO(row.generated_at), "UTC", "HH:mm")
      : null;
  const generatedTs = row?.generated_at ? Date.parse(row.generated_at) : null;
  const ageHours =
    generatedTs != null
      ? Math.max(0, Math.floor((Date.now() - generatedTs) / (1000 * 60 * 60)))
      : null;
  const briefReliability = formatReliabilityConfidenceDesk(
    reliabilityConfidenceFromBriefAgeHours(ageHours),
  );

  const watchItems = parseWatchList(row?.watch_list ?? null);

  const overnightBody =
    loading && !row
      ? "…"
      : (row?.overnight_summary?.trim() ||
          row?.executive_summary?.trim() ||
          "Brief generating...");

  const weatherBody =
    loading && !row ? "…" : row?.weather_watch?.trim() || "—";

  const oneRiskBody = loading && !row ? "…" : row?.one_risk?.trim() || "—";

  return (
    <>
      <div className="pointer-events-none absolute bottom-8 left-0 top-24 hidden sm:block">
        <ManuscriptMarginalia />
      </div>
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="border-b-[0.5px] border-ivory-border pb-6"
      >
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-mid">
          {headerTime != null
            ? `MORNING BRIEF · ${headerTime} GMT`
            : "MORNING BRIEF"}
        </p>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-light/60">
          Powered by Meridian
        </p>
        <h1 className="mt-3 font-serif text-4xl text-ink">The session ahead</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-mid">
          Drivers first, curves second. Sized to your book.
        </p>
      </motion.header>

      <motion.article
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="space-y-6 py-10"
      >
        <section>
          <h2 className={sectionLabelClass}>Reliability</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-mid">
            Confidence {briefReliability} ·{" "}
            {ageHours == null
              ? "brief timestamp unavailable"
              : `${ageHours}h since generation`}{" "}
            · Physical premium context (implied vs N2EX, residual demand) uses the
            latest model run when book touchpoints are personalised
            {bookTouchpointText ? " · personalised touchpoints active" : ""}
          </p>
        </section>

        <section>
          <h2 className={sectionLabelClass}>Overnight summary</h2>
          <p className="mt-3 font-serif text-lg leading-relaxed text-ink">
            {overnightBody}
          </p>
        </section>

        <section>
          <h2 className={sectionLabelClass}>Weather watch</h2>
          <p className="mt-3 font-serif text-lg leading-relaxed text-ink">
            {weatherBody}
          </p>
        </section>

        <section
          className="rounded-[4px] border-l-[2px] border-[#1D6B4E] pl-4"
          style={{ backgroundColor: "rgba(29, 107, 78, 0.03)" }}
        >
          <h2 className={sectionLabelClass}>One risk the market may be underpricing</h2>
          <p className="mt-3 font-serif text-lg leading-relaxed text-ink">
            {oneRiskBody}
          </p>
        </section>

        <section className="border-y-[0.5px] border-ivory-border py-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className={sectionLabelClass}>Watch list</h3>
            {!loading && watchItems.length > 0 ? (
              <span className="text-[10px] text-ink-light">
                {watchItems.length} item{watchItems.length === 1 ? "" : "s"} to
                watch
              </span>
            ) : null}
          </div>
          <ul className="mt-4">
            {loading ? (
              <li className="font-serif text-[15px] leading-relaxed text-ink">
                …
              </li>
            ) : watchItems.length > 0 ? (
              watchItems.map((item, idx) => (
                <li
                  key={item}
                  className={`flex gap-3 border-ivory-border py-3 font-serif text-[15px] leading-relaxed text-ink transition-colors hover:bg-ivory-dark ${
                    idx < watchItems.length - 1
                      ? "border-b-[0.5px]"
                      : ""
                  }`}
                >
                  <span
                    className="mt-0.5 shrink-0 text-bull"
                    aria-hidden
                  >
                    →
                  </span>
                  <span className="min-w-0 flex-1">{item}</span>
                </li>
              ))
            ) : (
              <li className="py-2 text-ink-mid">—</li>
            )}
          </ul>
        </section>

        <section>
          <p className={bookTouchpointsLabelClass}>BOOK TOUCHPOINTS</p>
          {portfolioEnabled === false ? (
            <div className="relative mt-3 overflow-hidden rounded-[4px]">
              <div className="pointer-events-none select-none space-y-2 p-3 blur-[2px] opacity-60">
                <div className="h-4 w-full rounded bg-ink/10" />
                <div className="h-4 w-[80%] rounded bg-ink/10" />
                <div className="h-4 w-[60%] rounded bg-ink/10" />
                <div className="mt-3 h-3 w-48 rounded bg-ink/8" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory/95 px-5 py-4 text-center shadow-md">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
                    Pro plan required
                  </p>
                  <p className="mt-1 text-xs text-ink-mid">Personalised position touchpoints</p>
                  <button
                    type="button"
                    disabled={touchpointCheckoutLoading}
                    onClick={() => {
                      setTouchpointCheckoutLoading(true);
                      void startStripeSubscriptionCheckout({
                        tier: "pro",
                        interval: "monthly",
                      }).catch(() => {
                        setTouchpointCheckoutLoading(false);
                      });
                    }}
                    className="mt-3 inline-flex items-center rounded-[4px] bg-ink px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ivory transition-colors hover:bg-[#1f1d1a] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {touchpointCheckoutLoading ? "Redirecting…" : "Get Pro →"}
                  </button>
                </div>
              </div>
            </div>
          ) : bookTouchpointLoading ? (
            <div className="mt-3 space-y-2">
              <div className="h-4 w-full rounded bg-ivory-dark animate-pulse" />
              <div className="h-4 w-3/4 rounded bg-ivory-dark animate-pulse" />
              <div className="h-4 w-1/2 rounded bg-ivory-dark animate-pulse" />
            </div>
          ) : bookTouchpointText ? (
            <>
              <p className="mt-3 font-serif text-lg leading-relaxed text-ink">
                {bookTouchpointText}
              </p>
              <div className="mt-4 border-t-[0.5px] border-ivory-border pt-3">
                <p className="text-[11px] text-ink-light">
                  Personalised to: {personalisationSummaryLine(touchpointPositions)}
                </p>
              </div>
            </>
          ) : positions.length === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-ink-mid">
              Import your positions in the Book tab to see a personalised read of
              how today&apos;s physical drivers affect your specific exposures. The
              model maps each signal — wind, gas, REMIT, carbon — to your open
              positions and tells you what it means for your P&amp;L.
            </p>
          ) : bookTouchpointError ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm leading-relaxed text-ink-mid">
                {bookTouchpointError}
              </p>
              <button
                type="button"
                onClick={() => {
                  // Simple retry: clear cached LS for this brief and reload.
                  // (Avoids chasing state in-place.)
                  try {
                    const ga = row?.generated_at?.trim() ?? "";
                    const supabase = createBrowserClient();
                    void supabase.auth.getUser().then(({ data }) => {
                      const uid = data.user?.id;
                      if (!uid || !ga) return;
                      localStorage.removeItem(
                        `${BOOK_TOUCHPOINTS_CACHE_PREFIX}${uid}:${ga}`,
                      );
                      window.location.reload();
                    });
                  } catch {
                    window.location.reload();
                  }
                }}
                className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2 text-xs font-semibold tracking-[0.08em] text-ink transition-colors hover:bg-ivory-dark"
              >
                Retry touchpoints
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm italic leading-relaxed text-ink-light">
              A personalised read for your open positions is unavailable right
              now. Check the Book tab for your live lines — the sections above
              still reflect today&apos;s physical run.
            </p>
          )}
        </section>

        <div className="border-t-[0.5px] border-ivory-border pt-8">
          <h2 className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-light">
            Further reading
          </h2>
          <div className="mt-4 space-y-4">
            {loading ? (
              <p className="text-ink-mid">…</p>
            ) : articlesWithThumbnails.length > 0 ? (
              articlesWithThumbnails.map((article, index) => (
                <FurtherReadingArticleCard
                  key={
                    normalizeArticleHref(article.url) ??
                    `article-${index}-${article.headline?.slice(0, 24)}`
                  }
                  article={article}
                />
              ))
            ) : (
              <p className="text-[13px] text-ink-mid">
                No further-reading items with preview images yet — the morning brief
                usually lists 3–5 once today&apos;s run completes.
              </p>
            )}
          </div>
        </div>
      </motion.article>
    </>
  );
}

"use client";

import { ManuscriptMarginalia } from "@/components/ui/ManuscriptMarginalia";
import { createBrowserClient } from "@/lib/supabase/client";
import { parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { motion } from "framer-motion";
import Image from "next/image";
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
  articles: BriefArticle[] | null;
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

/** Served from /public/images/article-placeholder.png — replace that file to change artwork. */
const ARTICLE_THUMB_PLACEHOLDER = "/images/article-placeholder.png";

function FurtherReadingArticleCard({ article }: { article: BriefArticle }) {
  const [imgFailed, setImgFailed] = useState(false);
  const href = normalizeArticleHref(article.url);
  const thumb = article.thumbnail_url?.trim();
  const showImg = Boolean(thumb) && !imgFailed;

  const cardClass =
    "flex gap-4 rounded-lg border border-stone-200 p-4 transition-all duration-150 hover:border-stone-400 hover:shadow-md";

  const content = (
    <>
      <div className="relative h-32 w-56 shrink-0 overflow-hidden rounded-lg bg-[#f5f0e8] sm:h-36 sm:w-64">
        {showImg ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={thumb}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <Image
            src={ARTICLE_THUMB_PLACEHOLDER}
            alt=""
            fill
            sizes="(max-width: 640px) 224px, 256px"
            className="object-contain object-center"
            unoptimized
            draggable={false}
            priority={false}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-start justify-between">
          <span
            style={{
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#9ca3af",
            }}
          >
            {article.publication}
          </span>
          <span
            style={{
              fontSize: "11px",
              color: "#9ca3af",
              flexShrink: 0,
              marginLeft: "8px",
            }}
          >
            {article.published_date || ""}
          </span>
        </div>
        <div
          style={{
            fontSize: "16px",
            fontFamily: "Cormorant Garamond, serif",
            color: "#1a1a0e",
            marginBottom: "6px",
            lineHeight: 1.3,
          }}
        >
          {article.headline}
        </div>
        <div style={snippetClampStyle}>{article.snippet}</div>
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
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<BriefRow | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();

    async function load() {
      const { data, error } = await supabase
        .from("brief_entries")
        .select("*")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setRow(data as BriefRow);
      } else {
        setRow(null);
      }
      setLoading(false);
    }

    load();
  }, []);

  const articles: BriefArticle[] = Array.isArray(row?.articles)
    ? row!.articles!
    : [];

  const headerTime =
    row?.generated_at != null
      ? formatInTimeZone(parseISO(row.generated_at), "UTC", "HH:mm")
      : null;

  const watchItems = parseWatchList(row?.watch_list ?? null);

  const overnightBody = loading
    ? "…"
    : (row?.overnight_summary?.trim() ||
        row?.executive_summary?.trim() ||
        "Brief generating...");

  const weatherBody = loading ? "…" : row?.weather_watch?.trim() || "—";

  const oneRiskBody = loading ? "…" : row?.one_risk?.trim() || "—";

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
                  className={`flex gap-3 border-ivory-border py-3 font-serif text-[15px] leading-relaxed text-ink transition-colors hover:bg-[#f7f2ea] ${
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
          <h2 className={sectionLabelClass}>Book touchpoints</h2>
          <div className="mt-3 rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4">
            <p className="text-sm italic leading-relaxed text-ink-light">
              Book-native P&L attribution coming soon. Import your positions to
              see how today&apos;s physical signals impact your specific
              exposures.
            </p>
          </div>
        </section>

        <div className="border-t-[0.5px] border-ivory-border pt-8">
          <h2 className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-light">
            Further reading
          </h2>
          <div className="mt-4 space-y-4">
            {loading ? (
              <p className="text-ink-mid">…</p>
            ) : articles.length > 0 ? (
              articles.map((article, index) => (
                <FurtherReadingArticleCard
                  key={
                    normalizeArticleHref(article.url) ??
                    `article-${index}-${article.headline?.slice(0, 24)}`
                  }
                  article={article}
                />
              ))
            ) : (
              <p className="text-[13px] text-ink-mid">No articles linked yet.</p>
            )}
          </div>
        </div>
      </motion.article>
    </>
  );
}

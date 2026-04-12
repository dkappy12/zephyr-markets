"use client";

import { ManuscriptMarginalia } from "@/components/ui/ManuscriptMarginalia";
import { createBrowserClient } from "@/lib/supabase/client";
import { parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { motion } from "framer-motion";
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

function WindTurbineThumbPlaceholder() {
  return (
    <svg
      viewBox="0 0 100 120"
      className="h-20 w-16 text-stone-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <line x1="50" y1="20" x2="50" y2="110" />
      <line x1="50" y1="110" x2="35" y2="120" />
      <line x1="50" y1="110" x2="65" y2="120" />
      <line x1="50" y1="20" x2="20" y2="50" />
      <line x1="50" y1="20" x2="80" y2="35" />
      <line x1="50" y1="20" x2="45" y2="0" />
    </svg>
  );
}

function FurtherReadingArticleCard({ article }: { article: BriefArticle }) {
  const href =
    article.url != null &&
    typeof article.url === "string" &&
    article.url.trim() !== ""
      ? article.url.trim()
      : null;

  const thumbBlock = (
    <>
      {article.thumbnail_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={article.thumbnail_url}
          alt={article.headline}
          className="h-32 w-32 flex-shrink-0 rounded-lg object-cover"
          onError={(e) => {
            const target = e.currentTarget;
            target.style.display = "none";
            const placeholder = target.nextElementSibling as HTMLElement;
            if (placeholder) placeholder.style.display = "flex";
          }}
        />
      ) : null}
      <div
        className="flex h-32 w-32 flex-shrink-0 items-center justify-center rounded-lg bg-stone-100"
        style={{
          display: article.thumbnail_url ? "none" : "flex",
        }}
      >
        <WindTurbineThumbPlaceholder />
      </div>
    </>
  );

  const body = (
    <div className="flex gap-4">
      <div className="shrink-0">{thumbBlock}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-row items-start justify-between gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-light">
            {article.publication}
          </span>
          {article.published_date ? (
            <span className="shrink-0 text-right text-[11px] text-ink-light">
              {article.published_date}
            </span>
          ) : null}
        </div>
        <span className="font-serif text-lg leading-snug text-ink">
          {article.headline}
        </span>
        <p className="line-clamp-3 text-sm leading-relaxed text-ink-mid">
          {article.snippet}
        </p>
        {article.author ? (
          <p className="text-[11px] text-ink-light">{article.author}</p>
        ) : null}
      </div>
    </div>
  );

  if (!href) {
    return (
      <li>
        <div className="block cursor-default rounded border border-stone-200 p-4 no-underline opacity-80">
          {body}
        </div>
      </li>
    );
  }

  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block border border-stone-200 rounded p-4 hover:border-stone-400 hover:shadow-sm transition-all cursor-pointer no-underline"
      >
        {body}
      </a>
    </li>
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

  useEffect(() => {
    articles.forEach((article, i) => {
      console.log(
        `[brief] article[${i}] thumbnail_url:`,
        article.thumbnail_url,
      );
    });
  }, [articles]);

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
          <ul className="mt-4 space-y-4">
            {loading ? (
              <li className="text-ink-mid">…</li>
            ) : articles.length > 0 ? (
              articles.map((article, i) => (
                <FurtherReadingArticleCard
                  key={
                    article.url
                      ? `${article.url}-${i}`
                      : `article-${i}-${article.headline?.slice(0, 12)}`
                  }
                  article={article}
                />
              ))
            ) : (
              <li className="text-[13px] text-ink-mid">No articles linked yet.</li>
            )}
          </ul>
        </div>
      </motion.article>
    </>
  );
}

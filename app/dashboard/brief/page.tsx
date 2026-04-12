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

  const articles: BriefArticle[] = Array.isArray(row?.articles)
    ? row!.articles!
    : [];

  return (
    <div className="relative mx-auto w-full max-w-4xl px-8">
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

        <section>
          <h3 className={sectionLabelClass}>Watch list</h3>
          <ul className="mt-3 space-y-2 font-serif text-base leading-relaxed text-ink">
            {loading ? (
              <li>…</li>
            ) : watchItems.length > 0 ? (
              watchItems.map((item) => <li key={item}>{item}</li>)
            ) : (
              <li className="text-ink-mid">—</li>
            )}
          </ul>
        </section>

        <section className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            Book touchpoints
          </p>
          <p className="mt-2 font-serif text-base leading-relaxed text-ink">
            {loading
              ? "…"
              : row?.book_touchpoints?.trim()
                ? row.book_touchpoints
                : "—"}
          </p>
        </section>

        <div className="border-t-[0.5px] border-ivory-border pt-8">
          <h2 className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-light">
            Further reading
          </h2>
          <ul className="mt-4 space-y-3">
            {loading ? (
              <li className="text-ink-mid">…</li>
            ) : articles.length > 0 ? (
              articles.map((a, i) => {
                const thumbUrl = a.thumbnail_url?.trim();
                const hasThumb = Boolean(thumbUrl);
                return (
                  <li key={`${a.url}-${i}`}>
                    <div className="flex flex-row gap-4 rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-3">
                      <div className="relative h-20 w-20 shrink-0">
                        {hasThumb ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={thumbUrl}
                              alt={a.headline}
                              className="h-20 w-20 flex-shrink-0 rounded object-cover bg-stone-200"
                              onError={(e) => {
                                const el = e.target as HTMLImageElement;
                                el.style.display = "none";
                                el.nextElementSibling?.classList.remove("hidden");
                              }}
                            />
                            <div
                              className="absolute inset-0 hidden h-20 w-20 rounded bg-stone-200"
                              aria-hidden
                            />
                          </>
                        ) : (
                          <div
                            className="h-20 w-20 flex-shrink-0 rounded bg-stone-200"
                            aria-hidden
                          />
                        )}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-row items-start justify-between gap-2">
                          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-light">
                            {a.publication}
                          </span>
                          {a.published_date ? (
                            <span className="shrink-0 text-right text-[11px] text-ink-light">
                              {a.published_date}
                            </span>
                          ) : null}
                        </div>
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-serif text-base leading-snug text-ink underline-offset-2 hover:underline"
                        >
                          {a.headline}
                        </a>
                        <p className="text-[13px] leading-relaxed text-ink-mid">
                          {a.snippet}
                        </p>
                        {a.author ? (
                          <p className="text-[11px] text-ink-light">{a.author}</p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })
            ) : (
              <li className="text-[13px] text-ink-mid">No articles linked yet.</li>
            )}
          </ul>
        </div>
      </motion.article>
    </div>
  );
}

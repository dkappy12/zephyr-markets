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

function BriefArticleThumbnailPlaceholder() {
  return (
    <svg
      viewBox="0 0 224 128"
      className="h-full w-full"
      aria-hidden
    >
      <rect width="224" height="128" fill="#F5F0E8" />
      <line
        x1="8"
        y1="102"
        x2="216"
        y2="102"
        stroke="#3D3D2E"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <line
        x1="112"
        y1="102"
        x2="112"
        y2="46"
        stroke="#3D3D2E"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      <circle cx="112" cy="42" r="3.5" fill="#3D3D2E" />
      <g
        stroke="#3D3D2E"
        strokeWidth="1.75"
        strokeLinecap="round"
        fill="none"
      >
        <line x1="112" y1="42" x2="112" y2="14" />
        <line x1="112" y1="42" x2="142" y2="58" />
        <line x1="112" y1="42" x2="82" y2="58" />
      </g>
    </svg>
  );
}

function FurtherReadingArticleCard({ a }: { a: BriefArticle }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbUrl = a.thumbnail_url?.trim();
  const showImage = Boolean(thumbUrl) && !thumbFailed;

  return (
    <li>
      <a
        href={a.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex cursor-pointer flex-row gap-4 rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4 text-inherit no-underline transition-shadow hover:shadow-md"
      >
        <div className="relative h-32 w-56 shrink-0 overflow-hidden rounded-lg bg-[#F5F0E8]">
          {showImage ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setThumbFailed(true)}
              />
            </>
          ) : (
            <BriefArticleThumbnailPlaceholder />
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
          <span className="font-serif text-lg leading-snug text-ink underline-offset-2 group-hover:underline">
            {a.headline}
          </span>
          <p className="line-clamp-3 text-sm leading-relaxed text-ink-mid">
            {a.snippet}
          </p>
          {a.author ? (
            <p className="text-[11px] text-ink-light">{a.author}</p>
          ) : null}
        </div>
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
          <ul className="mt-4 space-y-4">
            {loading ? (
              <li className="text-ink-mid">…</li>
            ) : articles.length > 0 ? (
              articles.map((a, i) => (
                <FurtherReadingArticleCard
                  key={`${a.url}-${i}`}
                  a={a}
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

"use client";

import { ManuscriptMarginalia } from "@/components/ui/ManuscriptMarginalia";
import { createBrowserClient } from "@/lib/supabase/client";
import { parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

type BriefRow = {
  generated_at: string;
  executive_summary: string | null;
  watch_list: string | null;
  book_touchpoints: string | null;
};

function parseWatchList(watchList: string | null): string[] {
  if (!watchList?.trim()) return [];
  return watchList
    .split("•")
    .map((s) => s.trim().replace(/^[-–—]\s*/, "").trim())
    .filter(Boolean);
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

  const execBody = loading
    ? "…"
    : row?.executive_summary?.trim()
      ? row.executive_summary
      : "Brief generating...";

  return (
    <div className="relative mx-auto max-w-[660px] pl-8 sm:pl-10">
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
          <h2 className="font-serif text-2xl text-ink">Executive summary</h2>
          <p className="mt-3 font-serif text-lg leading-relaxed text-ink">
            {execBody}
          </p>
        </section>
        <section>
          <h3 className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-mid">
            Watch list
          </h3>
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
      </motion.article>
    </div>
  );
}

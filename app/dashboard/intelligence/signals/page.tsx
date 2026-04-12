"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SignalCard, type SignalCardProps } from "@/components/ui/SignalCard";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  dedupeSignalRowsByTitleDescription,
  signalDedupeKey,
  type SignalRow,
  signalRowToCardProps,
} from "@/lib/signals";

const filters = [
  "All",
  "GB Power",
  "Gas",
  "Carbon",
  "REMIT",
] as const;

type CardWithId = SignalCardProps & { id: string };

function SignalCardSkeleton() {
  return (
    <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-4 py-3 animate-pulse">
      <div className="h-3 w-2/3 rounded bg-ivory-border/60" />
      <div className="mt-2 h-3 w-full rounded bg-ivory-border/40" />
      <div className="mt-2 h-3 w-4/5 rounded bg-ivory-border/40" />
      <div className="mt-4 h-2 w-32 rounded bg-ivory-border/30" />
    </div>
  );
}

export default function SignalsPage() {
  const [active, setActive] = useState<(typeof filters)[number]>("All");
  const [signals, setSignals] = useState<CardWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSignals = useCallback(async () => {
    const supabase = createBrowserClient();
    const { data, error: qError } = await supabase
      .from("signals")
      .select(
        "id, type, title, description, direction, source, confidence, created_at, raw_data",
      )
      .order("created_at", { ascending: false })
      .limit(50);

    if (qError) {
      setError(qError.message);
      setSignals([]);
      return;
    }
    setError(null);
    const rows = dedupeSignalRowsByTitleDescription(
      (data ?? []) as SignalRow[],
    );
    setSignals(rows.map(signalRowToCardProps));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadSignals().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadSignals]);

  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel("signals-inserts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "signals" },
        (payload) => {
          const row = payload.new as SignalRow;
          const mapped = signalRowToCardProps(row);
          const k = signalDedupeKey(row);
          setSignals((prev) => {
            if (prev.some((s) => s.id === mapped.id)) return prev;
            const rest = prev.filter(
              (s) => signalDedupeKey(s) !== k,
            );
            return [mapped, ...rest].slice(0, 50);
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    if (active === "All") return signals;
    if (active === "REMIT") {
      return signals.filter((s) => s.type === "remit");
    }
    return signals;
  }, [signals, active]);

  return (
    <div className="space-y-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Signal feed
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          Physical events with source, confidence, and desk-level readthrough.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const on = active === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setActive(f)}
              className={`rounded-[4px] border-[0.5px] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors duration-200 ${
                on
                  ? "border-ink bg-ivory-dark text-ink"
                  : "border-ivory-border bg-card text-ink-mid hover:border-ink/25"
              }`}
            >
              {f}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-3">
          <SignalCardSkeleton />
          <SignalCardSkeleton />
          <SignalCardSkeleton />
        </div>
      ) : error ? (
        <p className="text-sm text-bear">{error}</p>
      ) : signals.length === 0 ? (
        <p className="text-sm text-ink-mid">
          No signals yet. The ingestion pipeline is running.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink-mid">
          No signals match this filter.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map(({ id, ...card }) => (
            <motion.div
              key={id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <SignalCard {...card} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

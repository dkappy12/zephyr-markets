"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export default function MarketsPage() {
  const [loading, setLoading] = useState(true);
  const [gbPowerGbpMwh, setGbPowerGbpMwh] = useState<number | null>(null);
  const [ttfEurMwh, setTtfEurMwh] = useState<number | null>(null);
  const [deFullPct, setDeFullPct] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();

    async function load() {
      try {
        const [mp, gas, st] = await Promise.all([
          supabase
            .from("market_prices")
            .select("price_gbp_mwh")
            .eq("market", "N2EX")
            .order("price_date", { ascending: false })
            .order("settlement_period", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("gas_prices")
            .select("price_eur_mwh")
            .eq("hub", "TTF")
            .order("price_time", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("storage_levels")
            .select("full_pct")
            .eq("location", "DE")
            .order("report_date", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (!mp.error && mp.data) {
          setGbPowerGbpMwh(parseNum(mp.data.price_gbp_mwh));
        } else {
          setGbPowerGbpMwh(null);
        }

        if (!gas.error && gas.data) {
          setTtfEurMwh(parseNum(gas.data.price_eur_mwh));
        } else {
          setTtfEurMwh(null);
        }

        if (!st.error && st.data) {
          setDeFullPct(parseNum(st.data.full_pct));
        } else {
          setDeFullPct(null);
        }
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const gbDisplay = loading
    ? "…"
    : gbPowerGbpMwh === null
      ? "—"
      : `£${gbPowerGbpMwh.toFixed(2)}/MWh`;
  const ttfDisplay = loading
    ? "…"
    : ttfEurMwh === null
      ? "—"
      : `€${ttfEurMwh.toFixed(2)}/MWh`;
  const storageDisplay = loading
    ? "…"
    : deFullPct === null
      ? "—"
      : `${deFullPct.toFixed(1)}% full`;

  return (
    <div className="space-y-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Markets
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          Curves and spreads that matter for physical premia in GB and NW
          Europe.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0, duration: 0.28 }}
          className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            GB Power
          </p>
          <p className="mt-2 font-serif text-2xl text-ink tabular-nums">
            {gbDisplay}
          </p>
          <p className="mt-2 text-sm text-ink-mid">N2EX day-ahead</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.28 }}
          className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            NBP
          </p>
          <p className="mt-2 font-serif text-2xl text-ink tabular-nums">—</p>
          <p className="mt-1 text-xs text-ink-light">feed coming soon</p>
          <p className="mt-2 text-sm text-ink-mid">Day-ahead</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.28 }}
          className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            TTF
          </p>
          <p className="mt-2 font-serif text-2xl text-ink tabular-nums">
            {ttfDisplay}
          </p>
          <p className="mt-2 text-sm text-ink-mid">EEX NGP</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.28 }}
          className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            EU Storage
          </p>
          <p className="mt-2 font-serif text-2xl text-ink tabular-nums">
            {storageDisplay}
          </p>
          <p className="mt-2 text-sm text-ink-mid">Germany (GIE AGSI)</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.28 }}
          className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            EU Carbon
          </p>
          <p className="mt-2 font-serif text-2xl text-ink tabular-nums">—</p>
          <p className="mt-1 text-xs text-ink-light">feed coming soon</p>
          <p className="mt-2 text-sm text-ink-mid">Dec</p>
        </motion.div>
      </div>
    </div>
  );
}

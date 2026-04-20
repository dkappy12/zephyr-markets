"use client";

import {
  briefOneRiskCalloutClassName,
  briefOneRiskCalloutStyle,
} from "@/lib/brief-one-risk-callout";
import { createClient } from "@/lib/supabase/client";
import { TopoBackground } from "@/components/ui/TopoBackground";
import { TriangulationMesh } from "@/components/ui/TriangulationMesh";
import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.15,
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  }),
};

const PLAN_COMPARISON_ROWS: {
  feature: string;
  free: string;
  pro: string;
  team: string;
}[] = [
  { feature: "Price", free: "£0", pro: "£39/month", team: "£149/month" },
  { feature: "Seats", free: "1", pro: "1", team: "5" },
  {
    feature: "Signal feed",
    free: "Delayed 2h",
    pro: "Real-time",
    team: "Real-time",
  },
  {
    feature: "Physical premium score",
    free: "✓",
    pro: "✓",
    team: "✓",
  },
  {
    feature: "REMIT alerts",
    free: "Delayed 2h",
    pro: "Real-time",
    team: "Real-time",
  },
  {
    feature: "Portfolio positions",
    free: "-",
    pro: "Unlimited",
    team: "Unlimited",
  },
  {
    feature: "API access",
    free: "-",
    pro: "-",
    team: "✓",
  },
  {
    feature: "Data export",
    free: "-",
    pro: "-",
    team: "✓",
  },
  {
    feature: "Team management",
    free: "-",
    pro: "-",
    team: "Admin + invitations",
  },
  {
    feature: "Support",
    free: "Community",
    pro: "Email",
    team: "Priority email",
  },
];

function LiveTicker() {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    async function fetchTickerData() {
      const supabase = createClient();

      // Fetch latest physical premium
      const { data: premium } = await supabase
        .from("physical_premium")
        .select(
          "normalised_score, direction, implied_price_gbp_mwh, market_price_gbp_mwh, wind_gw, solar_gw, residual_demand_gw, regime",
        )
        .order("calculated_at", { ascending: false })
        .limit(1)
        .single();

      // Fetch latest N2EX price
      const { data: n2ex } = await supabase
        .from("market_prices")
        .select("price_gbp_mwh, price_time")
        .eq("market", "N2EX")
        .order("price_time", { ascending: false })
        .limit(1)
        .single();

      // Fetch latest TTF price
      const { data: ttf } = await supabase
        .from("gas_prices")
        .select("price_eur_mwh, price_time")
        .eq("hub", "TTF")
        .order("price_time", { ascending: false })
        .limit(1)
        .single();

      // Fetch latest NBP price
      const { data: nbp } = await supabase
        .from("gas_prices")
        .select("price_eur_mwh, price_time")
        .eq("hub", "NBP")
        .order("price_time", { ascending: false })
        .limit(1)
        .single();

      // Fetch EU storage (Germany as proxy)
      const { data: storage } = await supabase
        .from("storage_levels")
        .select("full_pct, country_code")
        .in("country_code", ["DE", "FR", "NL", "IT"])
        .order("recorded_at", { ascending: false })
        .limit(4);

      // Fetch recent REMIT signal count
      const { count: signalCount } = await supabase
        .from("signals")
        .select("*", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      // Build ticker items from live data
      const built: string[] = [];

      if (premium) {
        const sign = (premium.normalised_score ?? 0) >= 0 ? "+" : "";
        built.push(
          `PHYSICAL PREMIUM · ${sign}${premium.normalised_score?.toFixed(1)} ${premium.direction}`,
        );
        if (premium.implied_price_gbp_mwh)
          built.push(
            `IMPLIED PRICE · £${Number(premium.implied_price_gbp_mwh).toFixed(2)}/MWH`,
          );
        if (premium.wind_gw)
          built.push(`GB WIND · ${Number(premium.wind_gw).toFixed(1)} GW`);
        if (premium.solar_gw != null)
          built.push(`GB SOLAR · ${Number(premium.solar_gw).toFixed(1)} GW`);
        if (premium.residual_demand_gw)
          built.push(
            `RESIDUAL DEMAND · ${Number(premium.residual_demand_gw).toFixed(1)} GW`,
          );
        if (premium.regime)
          built.push(
            `REGIME · ${premium.regime.toUpperCase().replace("-", " ")}`,
          );
      }

      if (n2ex?.price_gbp_mwh) {
        built.push(`GB DAY-AHEAD · £${Number(n2ex.price_gbp_mwh).toFixed(2)}/MWH`);
      }

      if (ttf?.price_eur_mwh) {
        built.push(`TTF · €${Number(ttf.price_eur_mwh).toFixed(2)}/MWH`);
      }

      if (nbp?.price_eur_mwh) {
        built.push(`NBP · ${Number(nbp.price_eur_mwh).toFixed(2)} P/THERM`);
      }

      if (storage && storage.length > 0) {
        storage.forEach((s) => {
          if (s.full_pct) {
            built.push(
              `${s.country_code} GAS STORAGE · ${Number(s.full_pct).toFixed(1)}% FULL`,
            );
          }
        });
      }

      if (signalCount != null) {
        built.push(`REMIT SIGNALS 24H · ${signalCount}`);
      }

      // Fallback if fetch fails or returns empty
      if (built.length === 0) {
        built.push(
          "PHYSICAL PREMIUM · LIVE",
          "GB DAY-AHEAD · N2EX",
          "TTF · EEX NGP",
          "NBP · ICE",
          "REMIT · LIVE FEED",
          "WIND · OPEN-METEO",
          "SOLAR · PV LIVE",
          "EU STORAGE · GIE AGSI",
        );
      }

      setItems(built);
    }

    fetchTickerData();
    // Refresh every 5 minutes
    const interval = setInterval(fetchTickerData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Don't render until we have data (avoids flash of empty ticker)
  if (items.length === 0) return null;

  // Repeat items enough times to guarantee full width coverage regardless of screen size
  const repeated = [...items, ...items, ...items, ...items];

  return (
    <div className="border-b-[0.5px] border-ivory-border bg-ink text-ivory">
      <div className="relative overflow-hidden py-2">
        <div className="animate-ticker-marquee flex w-max gap-12 whitespace-nowrap font-sans text-[9px] font-medium uppercase tracking-[0.2em] text-ivory/90">
          {repeated.map((line, i) => (
            <span key={`${line}-${i}`}>{line}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [showComparison, setShowComparison] = useState(false);
  const [briefExpanded, setBriefExpanded] = useState(false);
  const [meridianStats, setMeridianStats] = useState<{
    overall_mae: number;
    overall_bias: number;
    filled_count: number;
    days_of_data: number;
    regime_stats: { regime: string; mae: number; n: number }[];
  } | null>(null);

  useEffect(() => {
    async function loadMeridianAccuracy() {
      try {
        const res = await fetch("/api/meridian/accuracy");
        if (!res.ok) return;
        const json = (await res.json()) as {
          overall_mae: number;
          overall_bias: number;
          filled_count: number;
          days_of_data: number;
          regime_stats: { regime: string; mae: number; n: number }[];
        };
        setMeridianStats(json);
      } catch {
        /* keep null */
      }
    }
    void loadMeridianAccuracy();
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-ivory">
      <nav className="sticky top-0 z-50 border-b-[0.5px] border-ivory-border bg-ivory/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="font-serif text-xl text-ink">
            Zephyr
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/login"
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-8 items-center rounded-[4px] bg-ink px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-ivory transition-colors hover:bg-[#1f1d1a]"
            >
              Start free
            </Link>
          </div>
        </div>
      </nav>
      <section className="relative overflow-hidden border-b-[0.5px] border-ivory-border">
        <div className="pointer-events-none absolute inset-0 z-0 min-h-[560px]">
          <TopoBackground className="h-full w-full min-h-[560px]" lineOpacity={0.25} />
        </div>
        <div className="pointer-events-none absolute bottom-0 right-0 z-[1] opacity-[0.14] sm:opacity-[0.18]">
          <TriangulationMesh width={280} height={360} opacity={0.22} strokeWidth={0.9} />
        </div>
        <div className="relative z-10 mx-auto max-w-[1100px] px-4 pb-16 pt-[100px] sm:px-6 sm:pb-24 sm:pt-[112px] lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <motion.h1
              custom={0}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mx-auto max-w-[22ch] font-serif text-[2.125rem] font-medium leading-[1.1] tracking-tight text-ink sm:text-5xl lg:text-[3.15rem]"
            >
              The GB power market, physically priced. In real time.
            </motion.h1>
            <motion.p
              custom={1}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-mid sm:text-lg"
            >
              Live REMIT signals, a CCGT-anchored premium score, sized to your
              book.
            </motion.p>
          </div>

          <motion.div
            custom={2}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="mx-auto mt-12 max-w-lg"
          >
            <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-5 text-ink shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-3 border-b border-ink/10 pb-4">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-bull animate-live-dot-pulse"
                    aria-hidden
                  />
                  <span className="font-sans text-[9px] font-semibold uppercase tracking-[0.2em] text-ink-mid">
                    Physical premium score
                  </span>
                </div>
                <span className="font-mono text-[10px] tabular-nums tracking-wide text-ink-mid">
                  06:00 GMT
                </span>
              </div>
              <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-serif text-5xl font-medium leading-none tracking-tight text-ink sm:text-[3.25rem]">
                  +1.8
                </span>
                <span className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                  Firming
                </span>
              </div>
              <div className="mt-6 space-y-2.5 font-mono text-[12px] leading-relaxed tabular-nums text-ink sm:text-[13px]">
                <p>
                  Implied £93.64 <span className="text-ink-light">·</span> N2EX £84.74 <span className="text-ink-light">·</span> Gap <span className="text-gold">+£8.90</span>
                </p>
                <p className="text-[11px] text-ink-mid sm:text-xs">
                  SRMC £101.42 <span className="text-ink-light">·</span> Wind 2.5 GW <span className="text-ink-light">·</span> Residual 20.5 GW
                </p>
              </div>
              <div className="mt-5 border-t border-ink/10 pt-4 font-mono text-[10px] leading-relaxed text-ink-mid sm:text-[11px]">
                <p>2,336 MW unplanned REMIT active</p>
                <p className="mt-1.5 text-ink-light">
                  Regime: gas-dominated
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <div className="w-full bg-ivory-dark py-10">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 sm:grid-cols-3 sm:gap-6">
            <ProductStat
              value="5 markets"
              label="GB power, TTF, NBP, UKA and EUA. Priced and scored side by side."
            />
            <ProductStat
              value="60 seconds"
              label="REMIT notice to scored signal in your feed."
            />
            <ProductStat
              value="8 sources"
              label="Elexon, EEX, GIE, Open-Meteo and more, reconciled into one stack."
            />
          </div>
        </div>
      </div>

      <LiveTicker />

      <section className="border-b-[0.5px] border-ivory-border bg-ivory py-20 sm:py-28">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45 }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-light">
              Signal feed
            </p>
            <h2 className="mt-3 font-serif text-3xl text-ink sm:text-[2rem]">
              Every REMIT notice, scored in plain English.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-mid">
              60-second ingest from the ELEXON feed. Impact sized in MW and
              £/MWh. The same cards you work from in-product.
            </p>
          </motion.div>
          <div className="mt-10 flex flex-col gap-4">
            <LandingSignalCard
              titleAsset="T_DRAXX-2"
              middleLine="645 MW offline (of 690 MW normal capacity) · Unplanned · Since 18 Apr 02:18 UTC · Until ~13:50 UTC 18 Apr · BMRS 02:22 UTC"
              assetTypeLabel="BASELOAD"
              severity="HIGH"
              timeIso="2026-04-18T02:18:00.000Z"
              timeUtc="18 Apr 2026 02:18 UTC"
              derationPct={100}
              implicationContext="Severe coal baseload loss overnight. Residual demand tight at 2.5 GW wind — pushes intraday curves toward the £101.42 SRMC anchor."
              priceImpactLine="~£3/MWh estimated price impact"
            />
            <LandingSignalCard
              titleAsset="T_SUTB-1"
              middleLine="583 MW offline (of 832 MW normal capacity) · Unplanned · Since 17 Apr 22:40 UTC · No return posted · Partial trip"
              assetTypeLabel="CCGT"
              severity="HIGH"
              timeIso="2026-04-17T22:40:00.000Z"
              timeUtc="17 Apr 2026 22:40 UTC"
              updateCount={2}
              derationPct={70}
              implicationContext="Major CCGT derate in a gas-dominated regime. Combined with Drax, over 1.2 GW thermal effectively offline at low wind."
              priceImpactLine="~£3/MWh estimated price impact"
            />
            <LandingSignalCard
              titleAsset="T_MRWD-1"
              middleLine="230 MW offline (of 920 MW normal capacity) · Planned · 14–22 Apr · Unit at 690 MW nominal · Priced in"
              assetTypeLabel="CCGT"
              severity="MEDIUM"
              timeIso="2026-04-14T06:00:00.000Z"
              timeUtc="14 Apr 2026 06:00 UTC"
              derationPct={25}
              implicationContext="Planned peaker rotation; the auction stack has largely priced this window."
              priceImpactLine="~£1/MWh estimated price impact"
            />
          </div>
        </div>
      </section>

      <section className="border-b-[0.5px] border-ivory-border bg-ivory-dark py-24 sm:py-32">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-light">
            P&amp;L attribution
          </p>
          <h2 className="mt-3 font-serif text-3xl text-ink sm:text-4xl">
            Every move in your book, explained.
          </h2>
          <p className="mt-3 max-w-xl text-sm text-ink-mid">
            Wind, gas, carbon, outages. Each driver sized in pounds, every
            morning.
          </p>
          <LandingAttributionMock />
        </div>
      </section>

      <section className="border-b-[0.5px] border-ivory-border bg-ivory-dark/40 py-16 sm:py-24">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          {/* Heading — left-aligned to break the centred rhythm */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45 }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-light">
              Morning brief
            </p>
            <h2 className="mt-3 font-serif text-3xl text-ink sm:text-[2rem]">
              Every data point, synthesised. In your inbox by 06:00.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-mid">
              Published every trading day, personalised to your open positions.
            </p>
          </motion.div>

          {/* Two-column layout */}
          <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-5 lg:items-stretch">
            {/* Left — nine source tiles */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, delay: 0.05 }}
              className="flex flex-col lg:col-span-2"
            >
              <p className="mb-3 flex items-center gap-2 font-serif text-base italic text-ink-mid">
                <span className="h-px w-6 bg-ink-light/50" aria-hidden />
                From this&hellip;
              </p>
              <LandingSourceGrid />
            </motion.div>

            {/* Right — morning brief */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, delay: 0.1 }}
              className="flex flex-col lg:col-span-3"
            >
              <p className="mb-3 flex items-center gap-2 font-serif text-base italic text-ink">
                <span className="font-mono not-italic text-[12px] text-ink-light" aria-hidden>
                  &rarr;
                </span>
                &hellip;to this.
              </p>
              <div className="relative">
                <div
                  className={`rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-6 py-8 sm:px-8 ${
                    briefExpanded ? "" : "max-h-[760px] overflow-hidden"
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-ivory-border pb-4">
                    <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-mid">
                      Morning brief · 06:00 GMT
                    </p>
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-light">
                      Powered by Meridian
                    </p>
                  </div>

                  <div className="mt-6 space-y-6">
                    <div>
                      <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
                        Reliability
                      </p>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-mid">
                        Confidence HIGH · published 06:00 GMT · premium context
                        (implied vs N2EX, residual demand) from the 05:55 model run
                        · personalised touchpoints active
                      </p>
                    </div>

                    <div>
                      <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
                        Overnight summary
                      </p>
                      <p className="mt-2 font-serif text-[16px] leading-relaxed text-ink">
                        Physical premium model shows a 1.8 normalised score in firming
                        mode, implying £93.64/MWh versus a market price of £84.74/MWh;
                        the £8.90/MWh gap signals the market is undervaluing physical
                        tightness. Wind outturn remains depressed at 2.5 GW with
                        residual demand at 20.5 GW, pushing the system into a
                        gas-dominated regime well above the 15 GW threshold.                         DRAXX-2
                        (645 MW coal unit) remains offline through at least 13:50 UTC
                        following an overnight unplanned outage; SUTB-1 is partially
                        tripped, generating at 249 MW of 832 MW nominal with no return
                        time posted, and capacity is degrading across multiple coal and
                        CCGT assets.
                      </p>
                    </div>

                    <div>
                      <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
                        Weather watch
                      </p>
                      <p className="mt-3 font-serif text-[16px] leading-relaxed text-ink">
                        Wind is forecast to accelerate into the second half of the
                        24-hour window, with the range 0.3&ndash;7.9 m/s implying
                        movement from very weak early session conditions toward
                        moderate-to-fresh afternoon winds; this should ease residual
                        demand pressure as wind climbs from 2.5 GW toward 5&ndash;6 GW
                        by late session. Temperature at 3.7&nbsp;&deg;C with a
                        3.4&ndash;9.3&nbsp;&deg;C span through the day is cold enough to
                        support baseline gas heating demand but without extreme stress.
                        The residual demand profile will trail down through the session
                        as renewables step up, reducing the need for rapid ramp-up from
                        thermal fleet in afternoon hours.
                      </p>
                    </div>

                    <section
                      className={briefOneRiskCalloutClassName}
                      style={briefOneRiskCalloutStyle}
                    >
                      <h2 className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
                        One risk the market may be underpricing
                      </h2>
                      <p className="mt-3 font-serif text-[16px] leading-relaxed text-ink">
                        The SRMC anchor sits at £101.42/MWh while the market trades
                        £84.74/MWh; if wind acceleration stalls or fails to materialise
                        and multiple thermal units remain stressed (DRAXX-2 through
                        13:50 UTC, SUTB-1 partially tripped with indefinite return,
                        TSREP-1 unplanned through 23:00 UTC), the system could flip to
                        emergency thermal dependency within hours. The 2,336 MW of
                        modelled REMIT capacity impact
                        is compressed into a period when residual demand is still
                        elevated at 20.5 GW; a wind forecast miss of just 2 m/s
                        (3.6 GW equivalent) would force dispatch into the £95&ndash;101
                        range. Current market pricing assumes wind delivery and
                        capacity recovery; neither is guaranteed this morning.
                      </p>
                    </section>

                    <div>
                      <div className="flex items-center gap-3">
                        <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
                          Watch list
                        </p>
                        <span className="font-mono text-[9px] text-ink-light">
                          3 items to watch
                        </span>
                      </div>
                      <div className="mt-3 space-y-3">
                        {[
                          "DRAXX-2 derated 645 MW through 13:50 UTC this morning; watch for reinstatement signals; any delay compounds thermal scarcity and pushes SP3\u2013SP10 toward SRMC anchor.",
                          "Wind profile front-loaded to weak first half (0.3 m/s initial) means residual demand will spike in early session; check N2EX intraday spreads for morning peak premium before acceleration kicks in.",
                          "T_NNGAO-2 rolls through planned deration 07:00\u201315:00 UTC (50\u201359 MW units); stacked outage window coincides with early weak wind; ensure ops readiness for rapid load swaps.",
                        ].map((item, i) => (
                          <div key={i} className="flex gap-3">
                            <span className="mt-0.5 shrink-0 font-mono text-[11px] text-ink-light">
                              &rarr;
                            </span>
                            <p className="text-[12px] leading-relaxed text-ink-mid">{item}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border-t border-ivory-border pt-5">
                      <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
                        Book touchpoints
                      </p>
                      <p className="mt-2 font-serif text-[15px] leading-relaxed text-ink">
                        The long 50 MW GB Power Q3-2026 benefits directly from the
                        £8.90/MWh gap between market and physically-implied price;
                        at 2.5 GW wind and 20.5 GW residual, the SRMC anchor at
                        £101.42 sits £16.68 above the current tape, and any delay to
                        DRAXX-2&apos;s return compounds the firming into the morning peak.
                        The short 25,000 therm NBP Winter-2026 at 114.7 carries
                        mark-to-market pressure from the overnight TTF firm; if gas
                        continues to price the thermal stack, this position absorbs
                        cross-commodity beta against the long power. The long 700
                        tco2 UKA Dec-2026 at 56.8 gains from widening EUA&ndash;UKA
                        spread pressures as UKA firms alongside thermal demand. The
                        single biggest risk is the 1,050 MW of active REMIT outages
                        returning to service, which would compress residual demand
                        below 15 GW and collapse the physically-implied premium;
                        monitor REMIT releases and TSO capacity notices between 08:00
                        and 10:00 UTC.
                      </p>
                      <p className="mt-5 border-t border-ivory-border pt-4 font-mono text-[9px] leading-relaxed text-ink-light/70">
                        Personalised to: Long 50 MW GB Power Q3-2026 · Short 25,000
                        therm NBP Winter-2026 · Long 700 tco2 UKA Dec-2026
                      </p>
                    </div>
                  </div>
                </div>
                {!briefExpanded ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-64 rounded-b-[4px] bg-gradient-to-t from-ivory via-ivory/70 to-transparent"
                  />
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setBriefExpanded((v) => !v)}
                aria-expanded={briefExpanded}
                className="mx-auto mt-5 flex w-max items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mid transition-colors hover:text-ink"
              >
                {briefExpanded ? "Show less" : "Read the full brief"}
                <span aria-hidden className="text-[13px]">
                  {briefExpanded ? "\u2191" : "\u2193"}
                </span>
              </button>
            </motion.div>
          </div>
        </div>
      </section>

      <section
        id="meridian"
        className="border-y-[0.5px] border-ivory-border bg-ivory py-16 sm:py-20"
      >
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start lg:gap-20">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-light">
                Meridian
              </p>
              <h2 className="mt-3 font-serif text-3xl text-ink sm:text-4xl">
                The model that improves itself.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-ink-mid">
                Every night Meridian scores its physically-implied price
                predictions against N2EX settlement and updates its own
                coefficients. No manual tuning, no stale parameters.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-ink-mid">
                Most analytics platforms don&apos;t publish their own accuracy. We do.
              </p>
              <div className="mt-8 grid grid-cols-2 gap-4 border-t-[0.5px] border-ivory-border pt-6 sm:max-w-sm">
                <div>
                  <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-light">
                    Days in production
                  </p>
                  <p className="mt-1 font-serif text-2xl text-ink">
                    {meridianStats != null
                      ? meridianStats.days_of_data.toLocaleString("en-GB")
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-light">
                    Settlement periods scored
                  </p>
                  <p className="mt-1 font-serif text-2xl text-ink">
                    {meridianStats != null
                      ? meridianStats.filled_count.toLocaleString("en-GB")
                      : "—"}
                  </p>
                </div>
              </div>
              <p className="mt-6 text-[11px] leading-relaxed text-ink-light">
                Every prediction scored against N2EX settlement. Every coefficient
                update gated on sample size. No hidden benchmarks.
              </p>
            </div>
            <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-6">
              <div className="flex items-center justify-between border-b border-ivory-border pb-4">
                <div className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-bull animate-live-dot-pulse"
                    aria-hidden
                  />
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-light">
                    Meridian · live accuracy
                  </p>
                </div>
                <span className="rounded-[3px] border-[0.5px] border-ivory-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mid">
                  {meridianStats != null
                    ? `n=${meridianStats.filled_count} periods`
                    : "Live"}
                </span>
              </div>

              {/* Top stats row */}
              <div className="mt-5 grid grid-cols-2 gap-4 border-b border-ivory-border pb-5">
                <div>
                  <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-light">
                    Overall MAE
                  </p>
                  <p className="mt-1 font-serif text-2xl text-ink">
                    {meridianStats != null ? (
                      <>
                        £{meridianStats.overall_mae.toFixed(2)}
                        <span className="font-sans text-xs text-ink-mid">/MWh</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </p>
                  <p className="mt-0.5 font-sans text-[9px] text-ink-light">
                    Mean absolute error vs settlement
                  </p>
                </div>
                <div>
                  <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-light">
                    Bias
                  </p>
                  {meridianStats == null ? (
                    <p className="mt-1 font-serif text-2xl text-ink">—</p>
                  ) : (
                    <>
                      <p className="mt-1 font-serif text-2xl text-ink">
                        {meridianStats.overall_bias >= 0 ? "+" : "\u2212"}£
                        {Math.abs(meridianStats.overall_bias).toFixed(2)}
                        <span className="font-sans text-xs text-ink-mid">/MWh</span>
                      </p>
                      <p className="mt-0.5 font-sans text-[9px] text-ink-light">
                        Model runs {Math.abs(meridianStats.overall_bias).toFixed(2)}{" "}
                        {meridianStats.overall_bias >= 0 ? "above" : "below"}{" "}
                        settlement on average
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* MAE by regime */}
              <div className="mt-5">
                <p className="mb-3 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-light">
                  MAE by regime
                </p>
                {(() => {
                  const regimes = ["Gas-dominated", "Transitional", "Renewable"] as const;
                  const maxMae = Math.max(
                    ...regimes.map((label) => {
                      const row = meridianStats?.regime_stats?.find(
                        (r) => r.regime === label,
                      );
                      return row?.mae ?? 0;
                    }),
                    0.01,
                  );
                  return regimes.map((regimeLabel) => {
                    const row = meridianStats?.regime_stats?.find(
                      (r) => r.regime === regimeLabel,
                    );
                    const pct =
                      row != null && row.mae > 0
                        ? Math.max(4, Math.min(100, (row.mae / maxMae) * 100))
                        : 0;
                    return (
                      <div
                        key={regimeLabel}
                        className="border-b border-ivory-border py-2.5 last:border-0"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-ink-mid">{regimeLabel}</span>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-[10px] text-ink-light">
                              {row != null ? `n=${row.n}` : "—"}
                            </span>
                            <span className="font-mono text-[12px] tabular-nums text-ink">
                              {row != null ? `£${row.mae.toFixed(2)}` : "—"}
                            </span>
                          </div>
                        </div>
                        {row != null ? (
                          <div
                            className="mt-1.5 h-1 w-full overflow-hidden rounded-[2px] bg-ivory-dark"
                            aria-hidden
                          >
                            <div
                              className="h-full rounded-[2px] bg-ink/55"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Calibration governance */}
              <div className="mt-5 rounded-[3px] border-[0.5px] border-ivory-border bg-ivory px-4 py-3">
                <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-light">
                  Calibration governance
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-mid">
                  Coefficient updates are gated: Meridian only promotes new parameters
                  once regime-specific sample thresholds are met. No untested
                  parameters ever hit production.
                </p>
              </div>

              <p className="mt-4 text-[10px] leading-relaxed text-ink-light">
                Recalibrates nightly at 02:00 UTC against N2EX settlement. MAE and
                bias update live across the rolling window.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="py-16 sm:py-20">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="font-serif text-3xl text-ink sm:text-4xl">Pricing</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-mid">
              Start on delayed data. Upgrade when you need real time and the full
              market set.
            </p>
          </div>
          <div className="mt-12 grid items-stretch gap-6 md:grid-cols-3">
            <PricingCard
              name="Free"
              price="£0"
              blurb="Physical premium score, morning brief (06:00 GMT), and signal feed with 2h delay. No credit card required."
              cta="Start free"
              href="/signup"
              emphasis={false}
            />
            <PricingCard
              name="Pro"
              price="£39"
              period="/month"
              blurb="Real-time signals and REMIT alerts, all markets, unlimited portfolio positions."
              cta="Get Pro"
              href="/signup?plan=pro"
              emphasis
            />
            <PricingCard
              name="Team"
              price="£149"
              period="/month"
              blurb="Everything in Pro across five seats, plus API access, data export, and team management."
              cta="Get Team"
              href="/signup?plan=team"
              emphasis={false}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowComparison(!showComparison)}
            aria-expanded={showComparison}
            className="mx-auto mt-10 flex w-max items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
          >
            {showComparison ? "Hide feature comparison" : "Compare all features"}
            <span aria-hidden className="text-xs">
              {showComparison ? "\u2191" : "\u2193"}
            </span>
          </button>
          {showComparison ? (
            <div className="mt-6 overflow-x-auto rounded-[4px] border-[0.5px] border-ivory-border bg-card shadow-sm">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="border-b-[0.5px] border-ivory-border">
                    <th
                      scope="col"
                      className="sticky left-0 z-[1] bg-card px-4 py-4 text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid"
                    >
                      Feature
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-4 text-center font-serif text-lg font-medium text-ink"
                    >
                      Free
                    </th>
                    <th
                      scope="col"
                      className="border-x border-gold/45 bg-ivory-dark/50 px-4 py-4 text-center font-serif text-lg font-medium text-ink"
                    >
                      Pro
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-4 text-center font-serif text-lg font-medium text-ink"
                    >
                      Team
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PLAN_COMPARISON_ROWS.map((row) => (
                    <tr
                      key={row.feature}
                      className="border-b-[0.5px] border-ivory-border last:border-b-0"
                    >
                      <th
                        scope="row"
                        className="sticky left-0 z-[1] bg-card px-4 py-3 text-sm font-medium text-ink"
                      >
                        {row.feature}
                      </th>
                      <PlanComparisonCell value={row.free} />
                      <PlanComparisonCell value={row.pro} highlight />
                      <PlanComparisonCell value={row.team} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="mt-8 text-center text-sm text-ink-light">
            Need more than 5 seats?{" "}
            <a
              href="mailto:contact@zephyr.markets"
              className="text-ink-mid underline decoration-ivory-border underline-offset-2 transition-colors hover:text-ink"
            >
              contact@zephyr.markets
            </a>
          </p>
        </div>
      </section>

      <footer className="border-t-[0.5px] border-ivory-border py-10">
        <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-center gap-3 px-4 text-center sm:px-6 lg:px-8">
          <a
            href="#meridian"
            className="mb-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-light/60 transition-colors hover:text-ink-light"
          >
            Powered by Meridian
          </a>
          <p className="text-xs text-ink-mid">
            Zephyr Markets © 2026 ·{" "}
            <a
              href="mailto:contact@zephyr.markets"
              className="text-ink-mid underline decoration-ivory-border underline-offset-2 transition-colors hover:text-ink"
            >
              contact@zephyr.markets
            </a>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link
              href="/privacy"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Terms
            </Link>
            <Link
              href="/docs"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Docs
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

type SourceRow = { label: string; value: string; tone?: string };
type SourceTile = { meta: string; rawLine: string; rows: SourceRow[] };

const LANDING_SOURCE_TILES: SourceTile[] = [
  {
    meta: "REMIT · 05:42",
    rawLine: "ELEXON/BMRS · REMIT/PUB/202604180542 · msg_8f3a2c1e\u2026",
    rows: [
      { label: "DRAXX-2", value: "645 MW U", tone: "text-[#8B3A3A]" },
      { label: "SUTB-1", value: "583 MW U", tone: "text-[#8B3A3A]" },
      { label: "T_NNGAO-2", value: "59 MW P" },
      { label: "TSREP-1", value: "410 MW U", tone: "text-[#8B3A3A]" },
      { label: "T_MRWD-1", value: "230 MW P" },
      { label: "Unplanned", value: "2,336 MW" },
      { label: "24h signals", value: "17 scored" },
      { label: "+more", value: "5 U · +698 MW", tone: "text-ink-light" },
    ],
  },
  {
    meta: "ELEXON · LIVE",
    rawLine: "BMRS/FUELINST · SP=2026-04-18T05:45Z · dataset=PUBLIC\u2026",
    rows: [
      { label: "Wind", value: "2.5 GW", tone: "text-[#8B3A3A]" },
      { label: "Solar", value: "0.2 GW" },
      { label: "CCGT", value: "17.8 GW" },
      { label: "Nuclear", value: "4.5 GW" },
      { label: "Pumped", value: "0.6 GW" },
      { label: "IC net", value: "+2.4 GW imp" },
      { label: "Residual", value: "20.5 GW" },
      { label: "+more", value: "14 fuel types", tone: "text-ink-light" },
    ],
  },
  {
    meta: "PVLIVE · SOLAR",
    rawLine: "sheffield.ac.uk/pvlive · v4/regional/national\u2026",
    rows: [
      { label: "Current", value: "0.2 GW" },
      { label: "Today pk", value: "1.8 GW" },
      { label: "Capacity", value: "16.9 GW" },
      { label: "Irrad.", value: "184 W/m\u00b2" },
      { label: "CF", value: "1.2%" },
      { label: "vs 7d", value: "-0.4 GW", tone: "text-[#8B3A3A]" },
      { label: "vs norm", value: "-3.1%", tone: "text-[#8B3A3A]" },
      { label: "+more", value: "847 sites", tone: "text-ink-light" },
    ],
  },
  {
    meta: "N2EX · DAY-AHEAD",
    rawLine: "BMRS/MID · N2EXMIDP · settlement_period=12\u2026",
    rows: [
      { label: "Base", value: "\u00a384.74" },
      { label: "Peak", value: "\u00a396.20" },
      { label: "Off-peak", value: "\u00a378.15" },
      { label: "Vol base", value: "11.8 GWh" },
      { label: "1d", value: "+1.6%", tone: "text-bull" },
      { label: "Pk/Op", value: "+\u00a318.05" },
      { label: "vs SRMC", value: "\u2212\u00a316.68", tone: "text-[#8B3A3A]" },
      { label: "+more", value: "46 SP/day", tone: "text-ink-light" },
    ],
  },
  {
    meta: "EEX · TTF",
    rawLine: "EEX/NGP · TTF_Front_Apr26 · curve_roll=auto\u2026",
    rows: [
      { label: "Front mo.", value: "\u20ac42.03" },
      { label: "Day-ahead", value: "\u20ac41.80" },
      { label: "1d", value: "+0.3%", tone: "text-bull" },
      { label: "1w", value: "-1.2%", tone: "text-[#8B3A3A]" },
      { label: "EU stor.", value: "38.4%" },
      { label: "LNG", value: "1.2 TWh/d" },
      { label: "Z1\u2013Z3", value: "contango", tone: "text-ink-mid" },
      { label: "+more", value: "12 hubs", tone: "text-ink-light" },
    ],
  },
  {
    meta: "ICE · NBP",
    rawLine: "STQ · NBP_FRONT_M · adj=HHV · stale_ms=840\u2026",
    rows: [
      { label: "Front mo.", value: "95.10p" },
      { label: "Day-ahead", value: "92.40p" },
      { label: "1d", value: "flat", tone: "text-ink-mid" },
      { label: "1w", value: "-1.2%", tone: "text-[#8B3A3A]" },
      { label: "Basis TTF", value: "+2%" },
      { label: "HHV adj.", value: "+0.4p" },
      { label: "WD spread", value: "+1.8p" },
      { label: "+more", value: "8 ladders", tone: "text-ink-light" },
    ],
  },
  {
    meta: "METEO · 24H",
    rawLine: "open-meteo · ECMWF_IFS · hourly=168 · step=1h\u2026",
    rows: [
      { label: "Wind", value: "0.3\u20137.9 m/s" },
      { label: "Min GW", value: "2.5", tone: "text-[#8B3A3A]" },
      { label: "Max GW", value: "5.8" },
      { label: "Dir.", value: "S-SW" },
      { label: "Gust", value: "9 m/s" },
      { label: "vs 7d", value: "\u22123.6 GW", tone: "text-[#8B3A3A]" },
      { label: "Temp", value: "3.4\u20139.3\u00b0C" },
      { label: "+more", value: "168 hrs", tone: "text-ink-light" },
    ],
  },
  {
    meta: "CARBON · 05:30",
    rawLine: "Ember v2 · EU_CARBON_EUR · fallback=last_good\u2026",
    rows: [
      { label: "EUA", value: "\u20ac72.40" },
      { label: "UKA", value: "\u00a344.10" },
      { label: "Spread", value: "\u20ac24.30" },
      { label: "EUA 1d", value: "+0.8%", tone: "text-bull" },
      { label: "UKA 1d", value: "-0.3%", tone: "text-[#8B3A3A]" },
      { label: "EUA vol", value: "0.8m" },
      { label: "Alloc.", value: "auction day" },
      { label: "+more", value: "3 hedges", tone: "text-ink-light" },
    ],
  },
  {
    meta: "YOUR BOOK · 3 OPEN",
    rawLine: "Supabase/positions · user_id=\u2026f2a9 · asof=06:00\u2026",
    rows: [
      { label: "GB Pwr Q3-26", value: "+50 MW" },
      { label: "NBP Win-26", value: "\u221225k th" },
      { label: "UKA Dec-26", value: "+700 tco2" },
      { label: "PnL today", value: "+\u00a3420", tone: "text-bull" },
      { label: "VaR 1d", value: "\u00a32,140" },
      { label: "Margin", value: "\u00a316.8k / 38%" },
      { label: "Notional", value: "\u00a31.8m" },
      { label: "Alignment", value: "mixed", tone: "text-ink-light" },
    ],
  },
];

const LANDING_FEED_TICKS: string[] = [
  "05:47:03  BMRS/MID   batch_close   n=46   lag=82ms",
  "05:46:11  REMIT      ingest        q=3    dedupe=on",
  "05:45:52  OPEN-METEO pull          hrs=168 model=IFS",
  "05:44:18  EEX/NGP    front_roll    TTF_Apr26",
  "05:43:06  SYNC       checkpoint    rows=412 merge=06:00:02",
  "05:42:19  PVLIVE     national      gw=1.12 cf=6.5%",
  "05:41:44  STQ/NBP    stale_ms=840  adj=HHV",
  "05:40:02  GIE/AGSI   eu_pct=38.4   d-1=-0.2%",
  "05:39:17  FRANKFURT  GBP/EUR       fix=daily",
  "05:38:55  EMBER      EUA_EUR       oilprice_fallback=off",
];

function LandingSourceGrid() {
  return (
    <div className="w-full overflow-hidden rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark/55">
      {/* Terminal-style header — darker register than the brief column */}
      <div className="flex items-center justify-between border-b-[0.5px] border-ivory-border bg-ivory-dark px-3 py-2.5 sm:px-4">
        <span className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-ink-light">
          06:00 GMT · 18 APR
        </span>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-live-dot-pulse rounded-full bg-bull" />
          <span className="font-mono text-[8.5px] text-ink-light">Live</span>
        </div>
      </div>

      {/* Clipped on small viewports only; full grid on lg+ (no fake void) */}
      <div className="relative max-h-[min(34rem,68svh)] overflow-hidden lg:max-h-none lg:overflow-visible">
        <div className="grid grid-cols-3 items-start gap-1 bg-ivory-dark/40 p-1">
          {LANDING_SOURCE_TILES.map((tile, i) => (
            <motion.div
              key={tile.meta}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{
                duration: 0.4,
                delay: 0.15 + i * 0.06,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="rounded-[3px] border-[0.5px] border-ivory-border/80 bg-ivory-dark/35 px-1.5 py-1"
            >
              <p className="font-mono text-[7px] uppercase leading-tight tracking-[0.1em] text-ink-light/90">
                {tile.meta}
              </p>
              <p
                className="mt-0.5 truncate font-mono text-[6.5px] leading-tight tracking-tight text-ink-light/55"
                title={tile.rawLine}
              >
                {tile.rawLine}
              </p>
              <div className="mt-0.5 space-y-px">
                {tile.rows.map((row, ri) => (
                  <div
                    key={`${tile.meta}-${ri}`}
                    className="flex items-baseline justify-between gap-1"
                  >
                    <span className="min-w-0 shrink font-mono text-[7px] leading-snug text-ink-light/85">
                      {row.label}
                    </span>
                    <span
                      className={`max-w-[55%] shrink-0 text-right font-mono text-[7.5px] leading-snug tabular-nums ${
                        row.tone ?? "text-ink-mid"
                      }`}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-ivory-dark/40 via-ivory-dark/15 to-transparent"
        />
      </div>

      {/* Static tick strip — dense tail of the merge log */}
      <div className="border-t-[0.5px] border-ivory-border/70 bg-ivory-dark/65 px-2 py-2.5 sm:px-2.5">
        <div className="space-y-0.5 font-mono text-[6.5px] leading-[1.5] text-ink-light/75">
          {LANDING_FEED_TICKS.map((line) => (
            <p key={line} className="truncate" title={line}>
              {line}
            </p>
          ))}
        </div>
        <p className="mt-2 border-t border-ivory-border/50 pt-2 font-mono text-[6.5px] leading-snug tracking-tight text-ink-light/60">
          8 feeds ingested · same ingestion stack as production · brief_run=06:00:00
          UTC
        </p>
      </div>
    </div>
  );
}

const landingAttrSectionLabel =
  "text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid";

const LANDING_ATTR_MOCK_GREEN = "#1D6B4E";
const LANDING_ATTR_MOCK_RED = "#8B3A3A";
const LANDING_ATTR_MOCK_TOTAL = "#2C2A26";

/** Static deltas summing to total P&L; order matches AttributionPageClient waterfall. */
/** Five-step illustrative bridge (+ Total); full app lists shape, demand, interconnector separately. */
const LANDING_ATTR_WATERFALL: { label: string; delta: number }[] = [
  { label: "Wind", delta: 540 },
  { label: "Gas", delta: -420 },
  { label: "Carbon", delta: 180 },
  { label: "REMIT", delta: 380 },
  { label: "Residual", delta: -260 },
];

const LANDING_ATTR_TABLE_ROWS: {
  name: string;
  impactGbp: number;
  direction: string;
}[] = [
  {
    name: "Wind generation",
    impactGbp: 540,
    direction: "Δwind −3.64 GW vs 7d baseline · +1.25 £/MWh",
  },
  {
    name: "Gas prices (TTF)",
    impactGbp: -420,
    direction: "62% SRMC vs DA · +0.95 £/MWh",
  },
  {
    name: "Carbon (UKA)",
    impactGbp: 180,
    direction: "UKA ref £55/t · EF 0.366 t/MWh · 18% of gas stack",
  },
  {
    name: "REMIT outages",
    impactGbp: 380,
    direction: "41% system stress · +0.88 £/MWh",
  },
  {
    name: "Residual",
    impactGbp: -260,
    direction: "unexplained after factor decomposition",
  },
];

function LandingAttributionWaterfallSvg() {
  const total = LANDING_ATTR_WATERFALL.reduce((s, r) => s + r.delta, 0);
  let cumMin = 0;
  let cumMax = 0;
  let run = 0;
  for (const r of LANDING_ATTR_WATERFALL) {
    run += r.delta;
    cumMin = Math.min(cumMin, run);
    cumMax = Math.max(cumMax, run);
  }
  cumMin = Math.min(cumMin, total, 0);
  cumMax = Math.max(cumMax, 0, total);
  // Add headroom so value labels don't clip against the top/bottom of the chart area.
  const rawSpan = cumMax - cumMin || 1;
  const headroom = rawSpan * 0.18;
  const yMax = cumMax + headroom;
  const yMin = cumMin - headroom;
  const span = yMax - yMin || 1;

  const W = 800;
  const H = 240;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const labelBand = 46;
  const chartW = W - padL - padR;
  const chartH = H - padT - labelBand;
  const labelBaselineY = H - 10;
  const nCols = LANDING_ATTR_WATERFALL.length + 1;
  const gap = 5;
  const colW = (chartW - gap * (nCols - 1)) / nCols;

  const yAt = (value: number) => padT + chartH * ((yMax - value) / span);

  const fmtDelta = (n: number) => {
    const sign = n >= 0 ? "+" : "\u2212";
    return `${sign}\u00A3${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
  };

  const gridLines: ReactNode[] = [];
  for (let gi = 0; gi <= 4; gi++) {
    const v = yMax - (span * gi) / 4;
    const y = yAt(v);
    gridLines.push(
      <line
        key={`g-${gi}`}
        x1={padL}
        y1={y}
        x2={W - padR}
        y2={y}
        stroke="rgba(44,42,38,0.06)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />,
    );
  }

  // Zero reference line (solid, slightly stronger) so up vs down is unambiguous.
  const yZero = yAt(0);
  gridLines.push(
    <line
      key="g-zero"
      x1={padL}
      y1={yZero}
      x2={W - padR}
      y2={yZero}
      stroke="rgba(44,42,38,0.28)"
      strokeWidth={1}
    />,
  );

  const bridgeLines: ReactNode[] = [];
  const bars: ReactNode[] = [];
  const labels: ReactNode[] = [];
  const valueLabels: ReactNode[] = [];

  let cum = 0;
  LANDING_ATTR_WATERFALL.forEach((step, i) => {
    const next = cum + step.delta;
    const low = Math.min(cum, next);
    const high = Math.max(cum, next);
    const x = padL + i * (colW + gap);
    const yTop = yAt(high);
    const yBot = yAt(low);
    const h = Math.max(yBot - yTop, 1);
    const fill = step.delta >= 0 ? LANDING_ATTR_MOCK_GREEN : LANDING_ATTR_MOCK_RED;
    bars.push(
      <rect key={`b-${i}`} x={x} y={yTop} width={colW} height={h} fill={fill} rx={2} />,
    );
    // Value label: positive deltas above bar, negative below.
    const valY = step.delta >= 0 ? yTop - 5 : yBot + 12;
    valueLabels.push(
      <text
        key={`v-${i}`}
        x={x + colW / 2}
        y={valY}
        textAnchor="middle"
        fill={fill}
        style={{
          fontSize: 10,
          fontFamily: "DM Mono, ui-monospace, monospace",
          fontWeight: 600,
        }}
      >
        {fmtDelta(step.delta)}
      </text>,
    );
    labels.push(
      <text
        key={`l-${i}`}
        x={x + colW / 2}
        y={labelBaselineY}
        textAnchor="middle"
        dominantBaseline="alphabetic"
        fill="#4a4640"
        style={{ fontSize: 10, fontFamily: "DM Sans, sans-serif", fontWeight: 500 }}
      >
        {step.label}
      </text>,
    );
    if (i < LANDING_ATTR_WATERFALL.length - 1) {
      const x1 = x + colW;
      const x2 = x + colW + gap;
      const y = yAt(next);
      bridgeLines.push(
        <line
          key={`c-${i}`}
          x1={x1}
          y1={y}
          x2={x2}
          y2={y}
          stroke="rgba(44,42,38,0.45)"
          strokeWidth={1.5}
          strokeDasharray="4 2"
        />,
      );
    }
    cum = next;
  });

  const ti = LANDING_ATTR_WATERFALL.length;
  const xTot = padL + ti * (colW + gap);
  const yTopTot = yAt(Math.max(0, total));
  const yBotTot = yAt(Math.min(0, total));
  const topTot = Math.min(yTopTot, yBotTot);
  const hTot = Math.abs(yBotTot - yTopTot);
  bars.push(
    <rect
      key="total"
      x={xTot}
      y={topTot}
      width={colW}
      height={Math.max(hTot, 1)}
      fill={LANDING_ATTR_MOCK_TOTAL}
      rx={2}
    />,
  );
  const totalValY = total >= 0 ? topTot - 5 : topTot + hTot + 12;
  valueLabels.push(
    <text
      key="v-tot"
      x={xTot + colW / 2}
      y={totalValY}
      textAnchor="middle"
      fill={LANDING_ATTR_MOCK_TOTAL}
      style={{
        fontSize: 11,
        fontFamily: "DM Mono, ui-monospace, monospace",
        fontWeight: 700,
      }}
    >
      {fmtDelta(total)}
    </text>,
  );
  labels.push(
    <text
      key="ltot"
      x={xTot + colW / 2}
      y={labelBaselineY}
      textAnchor="middle"
      dominantBaseline="alphabetic"
      fill="#2c2a26"
      style={{ fontSize: 10, fontFamily: "DM Sans, sans-serif", fontWeight: 600 }}
    >
      Total
    </text>,
  );

  const xLastEnd = padL + (ti - 1) * (colW + gap) + colW;
  bridgeLines.push(
    <line
      key="c-tot"
      x1={xLastEnd}
      y1={yAt(cum)}
      x2={xTot}
      y2={yAt(cum)}
      stroke="rgba(44,42,38,0.45)"
      strokeWidth={1.5}
      strokeDasharray="4 2"
    />,
  );

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto h-auto w-full max-w-[800px]"
        role="img"
        aria-label="Illustrative P&amp;L attribution waterfall by driver"
      >
        {gridLines}
        {bridgeLines}
        {bars}
        {valueLabels}
        {labels}
      </svg>
    </div>
  );
}

function LandingAttributionMock() {
  const totalPnl = LANDING_ATTR_WATERFALL.reduce((s, r) => s + r.delta, 0);
  const fmtGbp = (n: number) => {
    const sign = n >= 0 ? "+" : "−";
    const v = Math.abs(Math.round(n)).toLocaleString("en-GB");
    return `${sign}£${v}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45 }}
      className="mx-auto mt-10 max-w-[960px]"
    >
      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-[0.5px] border-ivory-border px-4 py-3 sm:px-5">
          <h3 className="font-serif text-2xl text-ink">Attribution</h3>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-light">
            18 Apr · 06:00 GMT
          </p>
        </div>

        <div className="grid gap-3 border-b-[0.5px] border-ivory-border bg-ivory px-4 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-5">
          <div>
            <p className={landingAttrSectionLabel}>Total P&amp;L today</p>
            <p
              className={`mt-1 text-lg font-semibold tabular-nums ${
                totalPnl >= 0 ? "text-bull" : "text-[#8B3A3A]"
              }`}
            >
              {fmtGbp(totalPnl)}
            </p>
          </div>
          <div>
            <p className={landingAttrSectionLabel}>Physical premium score</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gold">
              +1.8 FIRMING
            </p>
          </div>
          <div>
            <p className={landingAttrSectionLabel}>Book alignment</p>
            <p className="mt-1 text-sm font-semibold leading-snug text-ink-mid">
              MIXED — check breakdown
            </p>
          </div>
          <div>
            <p className={landingAttrSectionLabel}>Regime</p>
            <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-ink-mid">
              Gas-dominated
            </p>
          </div>
          <div>
            <p className={landingAttrSectionLabel}>Explained</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-ink">94%</p>
            <p className="mt-1 text-[11px] text-ink-mid">High confidence</p>
          </div>
        </div>

        <div className="px-3 py-3 pb-5 sm:px-4 sm:py-4 sm:pb-6">
          <p className={landingAttrSectionLabel}>P&amp;L attribution</p>
          <h4 className="mt-1 font-serif text-xl text-ink sm:text-2xl">
            What moved your book today
          </h4>

          <div className="mt-3 rounded-[4px] border-[0.5px] border-ivory-border bg-card px-1 pb-2 pt-1.5">
            <LandingAttributionWaterfallSvg />
          </div>

          <div className="mt-3 overflow-x-auto rounded-[4px] border-[0.5px] border-ivory-border bg-card">
            <table className="w-full min-w-0 border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-ivory-border text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-mid">
                  <th className="px-3 py-2 sm:px-4">Driver</th>
                  <th className="px-2 py-2 sm:px-3">Impact</th>
                  <th className="px-2 py-2 pr-3 sm:px-3 sm:pr-4">Direction</th>
                </tr>
              </thead>
              <tbody>
                {LANDING_ATTR_TABLE_ROWS.map((row) => {
                  const pos = row.impactGbp >= 0;
                  return (
                    <tr key={row.name} className="border-b border-ivory-border/80">
                      <td className="px-3 py-2 font-semibold text-ink sm:px-4 sm:py-2.5">
                        {row.name}
                      </td>
                      <td
                        className={`px-2 py-2 tabular-nums font-medium sm:px-3 sm:py-2.5 ${
                          pos ? "text-bull" : "text-[#8B3A3A]"
                        }`}
                      >
                        {fmtGbp(row.impactGbp)}
                      </td>
                      <td className="px-2 py-2 pr-3 text-ink-mid sm:px-3 sm:py-2.5 sm:pr-4">
                        {row.direction}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-ivory/60">
                  <td className="px-3 py-2 font-semibold text-ink sm:px-4 sm:py-2.5">
                    Total
                  </td>
                  <td
                    className={`px-2 py-2 tabular-nums font-semibold sm:px-3 sm:py-2.5 ${
                      totalPnl >= 0 ? "text-bull" : "text-[#8B3A3A]"
                    }`}
                  >
                    {fmtGbp(totalPnl)}
                  </td>
                  <td className="px-2 py-2 pr-3 text-ink-mid sm:px-3 sm:py-2.5 sm:pr-4">
                    —
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-xs text-ink-light">
            Shape, demand, and interconnector are separate drivers in-product.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/** Matches `StructuredSignalCard` / signal-feed page (`BRAND_GREEN` border on implication). */
const LANDING_SIGNAL_PRICE_BORDER = "#1D6B4E";

function landingSignalAssetPillClass(assetTypeLabel: string): string {
  const u = assetTypeLabel.toUpperCase();
  if (u === "CCGT")
    return "border-amber-700/35 bg-amber-50/80 text-amber-900";
  return "border-ivory-border bg-ivory text-ink-mid";
}

function landingSignalSeverityPillClass(s: "HIGH" | "MEDIUM" | "LOW"): string {
  switch (s) {
    case "HIGH":
      return "border-transparent bg-[#8B3A3A] text-white";
    case "MEDIUM":
      return "border-transparent bg-[#92400E] text-white";
    default:
      return "border-transparent bg-[#4B5320] text-white";
  }
}

/** Same breakpoints as `derationBarColor` in `app/dashboard/intelligence/signal-feed/page.tsx`. */
function landingDerationBarFill(pct: number): string {
  if (pct >= 99.5 || pct <= 0) return "#8B3A3A";
  if (pct >= 66) return "#9B3D20";
  if (pct >= 33) return "#B45309";
  return "#1D6B4E";
}

function landingPriceImpactRichText(line: string): ReactNode {
  const m = line.match(/^(.+?)\s+(estimated price impact)$/i);
  if (m) {
    return (
      <>
        {m[1]} <span className="font-semibold">{m[2]}</span>
      </>
    );
  }
  return line;
}

/**
 * Static REMIT row styled like `StructuredSignalCard` in
 * `app/dashboard/intelligence/signal-feed/page.tsx` (title row, MW line, bar, implication).
 */
function LandingSignalCard({
  titleAsset,
  eventLabel = "Generation Outage",
  assetTypeLabel,
  severity,
  updateCount,
  timeIso,
  timeUtc,
  middleLine,
  derationPct,
  implicationContext,
  priceImpactLine,
}: {
  titleAsset: string;
  eventLabel?: string;
  assetTypeLabel: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  updateCount?: number;
  /** Valid `dateTime` for `<time>` (UTC). */
  timeIso: string;
  timeUtc: string;
  middleLine: string;
  derationPct: number;
  implicationContext: string;
  priceImpactLine?: string;
}) {
  const terrPct = Math.max(0, Math.min(100, derationPct));
  const barFill = landingDerationBarFill(terrPct);
  const capacityBarLabel =
    terrPct >= 99.5 ? "FULLY OFFLINE" : `${Math.round(terrPct)}% derated`;

  return (
    <article className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex flex-wrap items-center gap-2">
          <h3 className="font-sans text-base font-semibold leading-snug text-ink">
            {titleAsset}
            {eventLabel ? (
              <span className="font-medium text-ink-mid"> — {eventLabel}</span>
            ) : null}
          </h3>
          <span
            className={`rounded-[3px] border-[0.5px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${landingSignalAssetPillClass(assetTypeLabel)}`}
          >
            {assetTypeLabel}
          </span>
          <span
            className={`rounded-[3px] border-[0.5px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${landingSignalSeverityPillClass(severity)}`}
          >
            {severity}
          </span>
          {updateCount != null && updateCount > 1 ? (
            <span className="rounded-[3px] border-[0.5px] border-ivory-border bg-ivory px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.04em] text-ink-mid">
              {updateCount} updates
            </span>
          ) : null}
        </div>
        <time
          className="shrink-0 text-[11px] tabular-nums text-ink-light"
          dateTime={timeIso}
        >
          {timeUtc}
        </time>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink">{middleLine}</p>

      <div className="mt-2">
        <div
          className="flex h-2 w-full overflow-hidden rounded-sm"
          style={{ backgroundColor: "#e5e1d9" }}
        >
          <div
            className="h-full shrink-0 rounded-sm transition-colors"
            style={{
              width: `${terrPct}%`,
              backgroundColor: barFill,
            }}
          />
        </div>
        <p className="mt-1 text-[10px] font-medium tabular-nums text-ink-mid">
          {capacityBarLabel}
        </p>
      </div>

      <p
        className="mt-3 border-l-2 pl-3 text-[11px] italic leading-relaxed text-ink-light"
        style={{ borderColor: LANDING_SIGNAL_PRICE_BORDER }}
      >
        {implicationContext}
        {priceImpactLine ? (
          <span className="ml-1 not-italic font-medium text-ink-mid">
            · {landingPriceImpactRichText(priceImpactLine)}
          </span>
        ) : null}
      </p>
    </article>
  );
}

function ProductStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center sm:text-left">
      <p className="font-serif text-4xl tracking-tight text-ink sm:text-[2.75rem]">
        {value}
      </p>
      <p className="mt-2 text-sm leading-snug text-ink-mid">{label}</p>
    </div>
  );
}

function PricingCard({
  name,
  price,
  period,
  blurb,
  cta,
  href,
  emphasis,
  footnote,
}: {
  name: string;
  price: string;
  period?: string;
  blurb: string;
  cta: string;
  href: string;
  emphasis?: boolean;
  footnote?: string;
}) {
  return (
    <div
      className={`relative flex h-full min-h-0 flex-col rounded-[4px] bg-card px-6 py-7 transition-shadow ${
        emphasis
          ? "border border-gold shadow-[0_8px_24px_-12px_rgba(140,105,30,0.35)]"
          : "border-[0.5px] border-ivory-border"
      }`}
    >
      {emphasis ? (
        <span className="absolute -top-2.5 left-6 rounded-[3px] bg-gold px-2 py-0.5 font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-ivory">
          Most popular
        </span>
      ) : null}
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-mid">
        {name}
      </p>
      <p className="mt-4 font-serif text-4xl text-ink">
        {price}
        {period ? (
          <span className="ml-1 font-sans text-sm font-medium text-ink-mid">
            {period}
          </span>
        ) : null}
      </p>
      <p className="mt-4 shrink-0 text-sm leading-relaxed text-ink-mid">{blurb}</p>
      <div className="min-h-0 flex-1" aria-hidden />
      <Link
        href={href}
        className={`mt-5 inline-flex h-10 w-full shrink-0 items-center justify-center rounded-[4px] text-xs font-semibold tracking-[0.08em] transition-colors duration-200 ${
          emphasis
            ? "bg-gold text-ivory hover:bg-[#7a5f1a]"
            : "border-[0.5px] border-ink/30 bg-ivory text-ink hover:border-ink hover:bg-ivory-dark"
        }`}
      >
        {cta}
      </Link>
      {footnote ? (
        <p className="mt-3 text-center text-[10px] leading-snug text-ink-light">
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

function PlanComparisonCell({
  value,
  highlight,
}: {
  value: string;
  highlight?: boolean;
}) {
  const isCheck = value === "✓";
  const isDash = value === "-";
  return (
    <td
      className={`px-4 py-3 text-center align-middle text-sm ${
        highlight ? "border-x border-gold/45 bg-ivory-dark/50" : ""
      } ${
        isCheck
          ? "font-medium text-bull"
          : isDash
            ? "text-ink-light"
            : "text-ink-mid"
      }`}
    >
      {value}
    </td>
  );
}

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
              href="/docs"
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Docs
            </Link>
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
              className="font-serif text-[2.125rem] font-medium leading-[1.1] tracking-tight text-ink sm:text-5xl lg:text-[3.15rem]"
            >
              The GB power market, physically priced. Every 5 minutes.
            </motion.h1>
            <motion.p
              custom={1}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-mid sm:text-lg"
            >
              Live REMIT signals, a CCGT-anchored premium score, and a 06:00 brief,
              sized to your book.
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
                  06:42 GMT
                </span>
              </div>
              <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-serif text-5xl font-medium leading-none tracking-tight text-ink sm:text-[3.25rem]">
                  +4.8
                </span>
                <span className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                  Firming
                </span>
              </div>
              <div className="mt-6 space-y-2 font-mono text-[11px] leading-relaxed tabular-nums text-ink-mid sm:text-xs">
                <p>
                  Implied £118.40 <span className="text-ink-light">·</span> N2EX £101.12
                </p>
                <p>
                  SRMC £89.50 <span className="text-ink-light">·</span> Wind 8.2 GW
                </p>
              </div>
              <div className="mt-5 border-t border-ink/10 pt-4 font-mono text-[10px] leading-relaxed text-ink-mid sm:text-[11px]">
                <p>3,240 MW unplanned REMIT active</p>
                <p className="mt-1.5 text-ink-light">
                  Regime: transitional → gas-dominated
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
              value="5 minutes"
              label="SRMC model recalculated against live TTF, wind and REMIT"
            />
            <ProductStat
              value="60 seconds"
              label="REMIT notice to scored signal in your feed"
            />
            <ProductStat
              value="8 sources"
              label="Elexon BMRS, EEX, Sheffield Solar PV_Live, GIE AGSI, OilPriceAPI, Open-Meteo and more"
            />
          </div>
        </div>
      </div>

      <LiveTicker />

      <section className="border-b-[0.5px] border-ivory-border bg-[#E8E0D0] py-20 sm:py-28">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45 }}
          >
            <h2 className="font-serif text-3xl text-ink sm:text-[2rem]">
              Every REMIT notice, scored in plain English.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-mid">
              Every notice scored, sized, and explained. The same feed you see
              in-product.
            </p>
          </motion.div>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            <LandingSignalCard
              meta="UNPLANNED · HIGH · 645 MW"
              title="T_DRAXX-4 · Drax Power Station Unit 4"
              detail="Unavailable from 13 Apr 06:00 - return unknown"
              implication="645 MW of baseload removed without notice. Tightens residual demand by ~1.5 GW when wind drops below 8 GW. Watch GB Power front-month."
              severity="high"
              assetLabel="Other"
            />
            <LandingSignalCard
              meta="PLANNED · MEDIUM · 920 MW"
              title="T_MRWD-1 · Mereworth Gas Turbine"
              detail="Maintenance outage 14-22 Apr"
              implication="Scheduled peaker maintenance. Market has priced this - no immediate action unless unplanned extension."
              severity="medium"
              assetLabel="CCGT"
            />
            <LandingSignalCard
              meta="INTERCONNECTOR · HIGH · 1,000 MW"
              title="IFA1 · France-GB Interconnector"
              detail="Reduced capacity from 2,000 MW to 1,000 MW"
              implication="Half of IFA1 flow removed. With French nuclear at 72% availability, this reduces import optionality during peak demand periods."
              severity="high"
              accent="interconnector"
              assetLabel="Interconnector"
            />
          </div>
        </div>
      </section>

      <section className="border-b-[0.5px] border-ivory-border bg-ivory-dark py-24 sm:py-32">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <h2 className="text-center font-serif text-3xl text-ink sm:text-4xl">
            Every move in your book, explained.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-ink-mid">
            Today&apos;s P&amp;L from your Book, decomposed into physical drivers—the same
            view as{" "}
            <span className="whitespace-nowrap">Portfolio → Attribution</span> (Pro).
          </p>
          <LandingAttributionMock />
          <p className="mx-auto mt-8 max-w-lg text-center text-sm text-ink-mid">
            <Link
              href="/#pricing"
              className="font-medium text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink/50"
            >
              P&amp;L attribution
            </Link>{" "}
            is included on Pro.
          </p>
          <p className="mx-auto mt-3 max-w-lg text-center text-xs text-ink-light">
            Power and gas marks refresh about every two minutes; fundamentals follow the
            live ingestion stack.
          </p>
        </div>
      </section>

      <section className="border-b-[0.5px] border-ivory-border bg-ivory-dark/40 py-16 sm:py-24">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-16">
          {/* Heading — full width, centred */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45 }}
            className="text-center"
          >
            <h2 className="font-serif text-3xl text-ink sm:text-[2rem]">
              Every data point, synthesised. In your inbox by 06:00.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink-mid">
              Published at 06:00 GMT every trading day, personalised to your open
              positions.
            </p>
          </motion.div>

          {/* Two-column layout */}
          <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-5 lg:items-start">
            {/* Left — nine source tiles */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, delay: 0.05 }}
              className="flex flex-col lg:col-span-2"
            >
              <p className="mb-3 font-serif text-[15px] italic text-ink-mid">
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
              <p className="mb-3 font-serif text-[15px] italic text-ink-mid">
                &hellip;to this.
              </p>
              <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-6 py-8 sm:px-8">
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
                      Confidence HIGH · Physical premium context uses latest model run ·
                      Book touchpoints personalised · 8 sources live
                    </p>
                  </div>

                  <div>
                    <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
                      Overnight summary
                    </p>
                    <p className="mt-2 font-serif text-[17px] leading-relaxed text-ink">
                      Physical premium model shows moderate firming with a normalised
                      score of +4.8, as market prices at £101.12/MWh sit £17.28/MWh below
                      the physically-implied £118.40/MWh. Wind generation at 8.2 GW with
                      solar adding 1.1 GW drives residual demand to 22.4 GW. Key
                      overnight REMIT signal: Drax Unit 4 unplanned 645 MW outage
                      continuing through multiple periods.
                    </p>
                  </div>

                  <div>
                    <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
                      Weather watch
                    </p>
                    <p className="mt-3 font-serif text-lg leading-relaxed text-ink">
                      Wind speeds forecast 4&ndash;9 m/s across the 24h window. If wind
                      falls materially below 6.5 GW in the second half, system flips
                      gas-marginal. Market currently prices flat to this transition
                      risk.
                    </p>
                  </div>

                  <section
                    className={briefOneRiskCalloutClassName}
                    style={briefOneRiskCalloutStyle}
                  >
                    <h2 className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
                      One risk the market may be underpricing
                    </h2>
                    <p className="mt-3 font-serif text-lg leading-relaxed text-ink">
                      Synchronised IFA2 outage (2×1,014 MW) combined with ~900 MW of
                      unplanned thermal outages removes ~2.9 GW of capacity during peak
                      morning demand. The 48p premium gap to physical value likely
                      understates scarcity risk in the 09:00&ndash;11:00 UTC window when
                      import support vanishes.
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
                        "IFA2 offline 08:00\u201310:45 UTC: monitor N2EX intraday for 10:00\u201311:00 UTC spike if wind <6.0 GW coincides.",
                        "SCCL-1 (400 MW unplanned) offline 06:00\u201312:30 UTC: cascading with IFA2 creates tight morning shoulder.",
                        "Wind forecast second-half decay: if outturn slips below 7.7 GW, residual demand approaches 15+ GW and pulls price toward SRMC (\u00a399.94/MWh).",
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
                      The long 50 MW GB Power Q3 2026 Baseload entered at £89.50 is
                      well-supported. Today&apos;s physical conditions suggest the
                      market is underpricing tightness risk by £17/MWh. The short
                      25,000 therm NBP Winter 2026 is correctly positioned given
                      temperature-suppressed demand; TTF at €50/MWh with weak heating
                      load supports the bias. Both carbon positions are immaterial to
                      this morning&apos;s regime. Single largest risk: 3,240 MW of
                      unplanned REMIT capacity active; any resolution could compress
                      the premium gap immediately.
                    </p>
                    <p className="mt-5 border-t border-ivory-border pt-4 font-mono text-[9px] leading-relaxed text-ink-light/70">
                      Personalised to: Long 50 MW GB Power Q3 2026 · Short 25,000 therm
                      NBP Winter 2026 · Long 700 tco2 UKA Dec-2026
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section
        id="meridian"
        className="border-y-[0.5px] border-ivory-border bg-ivory py-16 sm:py-20"
      >
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-20">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-light">
                Meridian
              </p>
              <h2 className="mt-3 font-serif text-3xl text-ink sm:text-4xl">
                The model that improves itself.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-ink-mid">
                Meridian is the autonomous calibration engine running behind every
                premium score. Every night it compares its predictions against actual
                N2EX settlement prices, recalculates its error, and updates its own
                coefficients. No manual tuning. No stale parameters.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-ink-mid">
                Most analytics platforms don&apos;t publish their own accuracy. We do.
              </p>
            </div>
            <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-6">
              <div className="flex items-center justify-between border-b border-ivory-border pb-4">
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-light">
                  Meridian · live accuracy
                </p>
                <span className="rounded-[3px] border-[0.5px] border-ivory-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-mid">
                  {meridianStats?.days_of_data ?? "—"} OF 18 DAYS
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
                </div>
                <div>
                  <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-light">
                    Bias
                  </p>
                  {meridianStats == null ? (
                    <p className="mt-1 font-serif text-2xl text-ink">—</p>
                  ) : meridianStats.overall_bias >= 0 ? (
                    <>
                      <p className="mt-1 font-serif text-2xl text-bull">
                        +£{meridianStats.overall_bias.toFixed(2)}
                        <span className="font-sans text-xs text-ink-mid">/MWh</span>
                      </p>
                      <p className="mt-0.5 font-sans text-[9px] text-ink-light">
                        {meridianStats.overall_bias > 0
                          ? "Slight overestimate"
                          : "Slight underestimate"}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-1 font-serif text-2xl text-[#8B3A3A]">
                        −£{Math.abs(meridianStats.overall_bias).toFixed(2)}
                        <span className="font-sans text-xs text-ink-mid">/MWh</span>
                      </p>
                      <p className="mt-0.5 font-sans text-[9px] text-ink-light">
                        Slight underestimate
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* MAE by regime */}
              <div className="mt-5">
                <p className="mb-3 font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-light">
                  MAE by regime
                </p>
                {(["Gas-dominated", "Transitional", "Renewable"] as const).map(
                  (regimeLabel) => {
                    const row = meridianStats?.regime_stats?.find(
                      (r) => r.regime === regimeLabel,
                    );
                    return (
                      <div
                        key={regimeLabel}
                        className="flex items-center justify-between border-b border-ivory-border py-2.5 last:border-0"
                      >
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
                    );
                  },
                )}
              </div>

              {/* Calibration status */}
              <div className="mt-5 rounded-[3px] border-[0.5px] border-ivory-border bg-ivory px-4 py-3">
                <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-light">
                  Calibration status
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-mid">
                  Coefficient updates are gated. Meridian will not promote new
                  parameters until sufficient settlement periods are observed.
                  Currently in warm-up.
                </p>
              </div>

              <p className="mt-4 text-[10px] leading-relaxed text-ink-light">
                Bias is mean signed error (predicted minus actual). Negative = model
                underestimating market price. Recalibrates nightly at 02:00 UTC.
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
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <PricingCard
              name="Free"
              price="£0"
              blurb="Physical premium score, morning brief (06:00 UTC), and signal feed. No credit card required."
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
          <p className="mt-10 text-center text-sm text-ink-light">
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

      <section
        aria-labelledby="plan-comparison-heading"
        className="border-b-[0.5px] border-ivory-border bg-ivory py-16 sm:py-20"
      >
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <h2
            id="plan-comparison-heading"
            className="text-center font-serif text-3xl text-ink sm:text-4xl"
          >
            Everything in the plan
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-ink-mid">
            Compare tiers at a glance. Upgrade when you need real time, depth, or a
            full desk on one book.
          </p>
          <button
            type="button"
            onClick={() => setShowComparison(!showComparison)}
            className="mx-auto mt-8 flex w-max items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
          >
            {showComparison ? "Hide feature comparison" : "Compare all features"}
            <span className="text-xs">{showComparison ? "↑" : "↓"}</span>
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
            <Link
              href="/login"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Sign up
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
      { label: "Drax U4", value: "645 MW U", tone: "text-[#8B3A3A]" },
      { label: "IFA2", value: "2,028 MW P" },
      { label: "SCCL-1", value: "400 MW U", tone: "text-[#8B3A3A]" },
      { label: "T_MRWD-1", value: "920 MW P" },
      { label: "FDUNT-1", value: "59 MW P" },
      { label: "Unplanned", value: "3,240 MW" },
      { label: "24h signals", value: "19 scored" },
      { label: "+more", value: "6 U · +847 MW", tone: "text-ink-light" },
    ],
  },
  {
    meta: "ELEXON · LIVE",
    rawLine: "BMRS/FUELINST · SP=2026-04-18T05:45Z · dataset=PUBLIC\u2026",
    rows: [
      { label: "Wind", value: "8.2 GW" },
      { label: "Solar", value: "1.1 GW" },
      { label: "CCGT", value: "14.2 GW" },
      { label: "Nuclear", value: "4.5 GW" },
      { label: "Pumped", value: "0.4 GW" },
      { label: "IC net", value: "+2.2 GW imp" },
      { label: "Residual", value: "22.4 GW" },
      { label: "+more", value: "14 fuel types", tone: "text-ink-light" },
    ],
  },
  {
    meta: "PVLIVE · SOLAR",
    rawLine: "sheffield.ac.uk/pvlive · v4/regional/national\u2026",
    rows: [
      { label: "Current", value: "1.1 GW" },
      { label: "Today pk", value: "2.8 GW" },
      { label: "Capacity", value: "16.9 GW" },
      { label: "Irrad.", value: "412 W/m\u00b2" },
      { label: "CF", value: "6.5%" },
      { label: "vs 7d", value: "+0.2 GW", tone: "text-bull" },
      { label: "vs norm", value: "-0.8%", tone: "text-[#8B3A3A]" },
      { label: "+more", value: "847 sites", tone: "text-ink-light" },
    ],
  },
  {
    meta: "N2EX · DAY-AHEAD",
    rawLine: "BMRS/MID · N2EXMIDP · settlement_period=12\u2026",
    rows: [
      { label: "Base", value: "\u00a3101.12" },
      { label: "Peak", value: "\u00a3108.20" },
      { label: "Off-peak", value: "\u00a394.05" },
      { label: "Vol base", value: "12.4 GWh" },
      { label: "1d", value: "+0.4%", tone: "text-bull" },
      { label: "Pk/Op", value: "+\u00a314.15" },
      { label: "vs SRMC", value: "\u2212\u00a312.38", tone: "text-ink-mid" },
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
      { label: "Wind", value: "4\u20139 m/s" },
      { label: "Min GW", value: "6.1" },
      { label: "Max GW", value: "9.8" },
      { label: "Dir.", value: "W-SW" },
      { label: "Gust", value: "11 m/s" },
      { label: "vs 7d", value: "+1.5 GW", tone: "text-bull" },
      { label: "p50 decay", value: "\u22120.8 GW", tone: "text-[#8B3A3A]" },
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
      { label: "GB Pwr Q3", value: "+50 MW" },
      { label: "NBP Win26", value: "-25k th" },
      { label: "UKA Dec26", value: "+700 tco2" },
      { label: "Unreal.", value: "+\u00a34,820", tone: "text-bull" },
      { label: "VaR 1d", value: "\u00a32,340" },
      { label: "Margin", value: "\u00a318.2k / 42%" },
      { label: "Notional", value: "\u00a32.1m" },
      { label: "+more", value: "2 alerts", tone: "text-ink-light" },
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
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-ivory-dark/40 via-ivory-dark/15 to-transparent lg:hidden"
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
const LANDING_ATTR_WATERFALL: { label: string; delta: number }[] = [
  { label: "Wind", delta: -920 },
  { label: "Gas", delta: -610 },
  { label: "Carbon", delta: -210 },
  { label: "REMIT", delta: 460 },
  { label: "Shape", delta: 260 },
  { label: "Demand", delta: -125 },
  { label: "Interconnector", delta: 58 },
  { label: "Residual", delta: -437 },
];

const LANDING_ATTR_TABLE_ROWS: {
  name: string;
  impactGbp: number;
  direction: string;
  weightPct: number;
}[] = [
  {
    name: "Wind generation",
    impactGbp: -920,
    direction: "Δwind −3.64 GW vs 7d baseline · −2.10 £/MWh",
    weightPct: 100,
  },
  {
    name: "Gas prices (TTF)",
    impactGbp: -610,
    direction: "62% SRMC vs DA · −0.85 £/MWh",
    weightPct: 66,
  },
  {
    name: "Carbon (UKA)",
    impactGbp: -210,
    direction: "UKA ref £55/t · EF 0.366 t/MWh · 18% of gas stack",
    weightPct: 23,
  },
  {
    name: "REMIT outages",
    impactGbp: 460,
    direction: "41% system stress · +1.20 £/MWh",
    weightPct: 50,
  },
  {
    name: "Shape / basis",
    impactGbp: 260,
    direction: "−0.35 £/MWh residual market move",
    weightPct: 28,
  },
  {
    name: "Demand surprise",
    impactGbp: -125,
    direction: "2 demand-linked signals · proxy sensitivity",
    weightPct: 14,
  },
  {
    name: "Interconnector flow",
    impactGbp: 58,
    direction: "1 flow-linked signals · proxy sensitivity",
    weightPct: 6,
  },
  {
    name: "Residual",
    impactGbp: -437,
    direction: "unexplained after factor decomposition",
    weightPct: 48,
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
  cumMin = Math.min(cumMin, total);
  cumMax = Math.max(cumMax, 0, total);
  const span = cumMax - cumMin || 1;

  const W = 860;
  const H = 228;
  const padL = 8;
  const padR = 8;
  const padT = 16;
  const padB = 52;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const nCols = LANDING_ATTR_WATERFALL.length + 1;
  const gap = 5;
  const colW = (chartW - gap * (nCols - 1)) / nCols;

  const yAt = (value: number) => padT + chartH * ((cumMax - value) / span);

  const gridLines: ReactNode[] = [];
  for (let gi = 0; gi <= 4; gi++) {
    const v = cumMax - (span * gi) / 4;
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

  const bridgeLines: ReactNode[] = [];
  const bars: ReactNode[] = [];
  const labels: ReactNode[] = [];

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
    labels.push(
      <text
        key={`l-${i}`}
        x={x + colW / 2}
        y={H - 8}
        textAnchor="end"
        dominantBaseline="middle"
        fill="#6B6760"
        transform={`rotate(-38 ${x + colW / 2} ${H - 8})`}
        style={{ fontSize: 8, fontFamily: "DM Sans, sans-serif" }}
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
          stroke="rgba(44,42,38,0.2)"
          strokeWidth={1}
          strokeDasharray="3 3"
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
  labels.push(
    <text
      key="ltot"
      x={xTot + colW / 2}
      y={H - 14}
      textAnchor="middle"
      fill="#6B6760"
      style={{ fontSize: 8, fontFamily: "DM Sans, sans-serif" }}
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
      stroke="rgba(44,42,38,0.2)"
      strokeWidth={1}
      strokeDasharray="3 3"
    />,
  );

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto h-auto w-full max-w-[860px]"
        role="img"
        aria-label="Illustrative P&amp;L attribution waterfall by driver"
      >
        {gridLines}
        {bridgeLines}
        {bars}
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
      <p className="text-center font-mono text-[10px] text-ink-light">
        Illustrative example · not live data
      </p>
      <div className="mt-4 overflow-hidden rounded-[4px] border-[0.5px] border-ivory-border bg-card">
        <div className="border-b-[0.5px] border-ivory-border px-4 py-4 sm:px-5">
          <h3 className="font-serif text-2xl text-ink">Attribution</h3>
          <p className="mt-1 text-sm text-ink-light">
            How today&apos;s physical drivers are moving your book.
          </p>
        </div>

        <div className="grid gap-4 border-b-[0.5px] border-ivory-border bg-ivory px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-5">
          <div>
            <p className={landingAttrSectionLabel}>Total P&amp;L today</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-[#8B3A3A]">
              {fmtGbp(totalPnl)}
            </p>
          </div>
          <div>
            <p className={landingAttrSectionLabel}>Physical premium score</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gold">
              +0.1 PHYSICAL
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
              Transitional
            </p>
          </div>
          <div>
            <p className={landingAttrSectionLabel}>Explained</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-ink">94%</p>
            <p className="mt-1 text-[11px] text-ink-mid">Low confidence</p>
          </div>
        </div>

        <div className="px-3 py-4 sm:px-4 sm:py-5">
          <p className={landingAttrSectionLabel}>P&amp;L attribution</p>
          <h4 className="mt-1 font-serif text-xl text-ink sm:text-2xl">
            What moved your book today
          </h4>

          <div className="mt-4 rounded-[4px] border-[0.5px] border-ivory-border bg-card px-1 py-2">
            <LandingAttributionWaterfallSvg />
          </div>

          <div className="mt-4 overflow-x-auto rounded-[4px] border-[0.5px] border-ivory-border bg-card">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-ivory-border text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-mid">
                  <th className="px-3 py-2.5 sm:px-4">Driver</th>
                  <th className="px-2 py-2.5 sm:px-3">Impact</th>
                  <th className="px-2 py-2.5 sm:px-3">Direction</th>
                  <th className="px-3 py-2.5 sm:px-4">Weight</th>
                </tr>
              </thead>
              <tbody>
                {LANDING_ATTR_TABLE_ROWS.map((row) => {
                  const pos = row.impactGbp >= 0;
                  return (
                    <tr key={row.name} className="border-b border-ivory-border/80">
                      <td className="px-3 py-2.5 font-semibold text-ink sm:px-4 sm:py-3">
                        {row.name}
                      </td>
                      <td
                        className={`px-2 py-2.5 tabular-nums font-medium sm:px-3 sm:py-3 ${
                          pos ? "text-bull" : "text-[#8B3A3A]"
                        }`}
                      >
                        {fmtGbp(row.impactGbp)}
                      </td>
                      <td className="px-2 py-2.5 text-ink-mid sm:px-3 sm:py-3">
                        {row.direction}
                      </td>
                      <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                        <div className="flex h-2 w-full max-w-[180px] overflow-hidden rounded-sm bg-ivory-dark/80">
                          <div
                            className="h-full"
                            style={{
                              width: `${row.weightPct}%`,
                              backgroundColor: pos
                                ? LANDING_ATTR_MOCK_GREEN
                                : LANDING_ATTR_MOCK_RED,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-ivory/60">
                  <td className="px-3 py-2.5 font-semibold text-ink sm:px-4 sm:py-3">
                    Total
                  </td>
                  <td className="px-2 py-2.5 tabular-nums font-semibold text-[#8B3A3A] sm:px-3 sm:py-3">
                    {fmtGbp(totalPnl)}
                  </td>
                  <td className="px-2 py-2.5 text-ink-mid sm:px-3 sm:py-3">—</td>
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3" />
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-ink-light">
            Model explains 94% of today&apos;s P&amp;L ({fmtGbp(-1427)} explained,{" "}
            {fmtGbp(-97)} residual) · confidence: Low.
          </p>
          <p className="mt-1 text-xs text-ink-light">
            Calibration sample too small — using conservative multipliers.
          </p>

          <button
            type="button"
            className="mt-3 flex cursor-default items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid"
            tabIndex={-1}
            aria-hidden
          >
            <span className="inline-block translate-y-px">▸</span>
            Expand position detail
          </button>
        </div>

        <div className="border-t-[0.5px] border-ivory-border px-3 py-4 sm:px-4 sm:py-5">
          <p className={landingAttrSectionLabel}>Physical signals</p>
          <h4 className="mt-1 font-serif text-lg text-ink">
            Active signals relevant to your positions
          </h4>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <article className="rounded-[4px] border-[0.5px] border-ivory-border border-l-[2px] border-l-bull bg-card px-3 py-2.5">
              <p className="text-[11px] font-semibold text-ink">
                T_DRAXX-2 · Drax Power Station Unit 2
              </p>
              <p className="mt-1 text-[11px] text-ink-mid">1,500 MW offline (unplanned)</p>
              <p className="mt-2 border-l-2 border-bull pl-2 text-[12px] italic leading-snug text-ink-mid">
                This supports your long GB baseload position — estimated{" "}
                <span className="not-italic font-medium text-bull">+£2,700</span> impact
              </p>
            </article>
            <article className="rounded-[4px] border-[0.5px] border-ivory-border border-l-[2px] border-l-bull bg-card px-3 py-2.5">
              <p className="text-[11px] font-semibold text-ink">
                T_NEWC-1 · New CCGT unit trip
              </p>
              <p className="mt-1 text-[11px] text-ink-mid">420 MW offline (unplanned)</p>
              <p className="mt-2 border-l-2 border-bull pl-2 text-[12px] italic leading-snug text-ink-mid">
                This supports your long GB baseload position — estimated{" "}
                <span className="not-italic font-medium text-bull">+£750</span> impact
              </p>
            </article>
          </div>
        </div>

        <div className="border-t-[0.5px] border-ivory-border px-3 py-4 sm:px-4 sm:py-5">
          <p className={landingAttrSectionLabel}>Alignment</p>
          <h4 className="mt-1 font-serif text-lg text-ink">Book vs physical conditions</h4>
          <div className="mt-4 rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-5">
            <div className="relative pt-5">
              <div className="flex justify-between text-[10px] font-medium uppercase tracking-[0.12em] text-ink-mid">
                <span>Fully bearish</span>
                <span>Fully bullish</span>
              </div>
              <div className="relative mt-2 h-3 rounded-full bg-gradient-to-r from-[#8B3A3A]/35 via-ivory-dark to-[#1D6B4E]/45">
                <div
                  className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-ink"
                  style={{ left: "50%" }}
                  title="50%"
                />
              </div>
            </div>
            <p className="mt-4 text-sm text-ink-mid">
              Your book is{" "}
              <span className="font-semibold tabular-nums text-ink">50%</span> aligned with
              current physical signals. Illustrative caption.
            </p>
          </div>
        </div>

        <div className="border-t-[0.5px] border-ivory-border px-3 py-4 sm:px-4 sm:py-5">
          <p className={landingAttrSectionLabel}>History</p>
          <h4 className="mt-1 font-serif text-lg text-ink">Historical P&amp;L</h4>
          <div className="mt-4 flex h-[100px] items-end gap-1.5 rounded-[4px] border-[0.5px] border-ivory-border bg-card px-3 pb-3 pt-3">
            {[44, 62, 28, 18, 52, 22, 36].map((pct, i) => (
              <div
                key={i}
                className="min-w-0 flex-1 rounded-sm bg-bull/30"
                style={{ height: `${pct}%`, maxHeight: "72px" }}
              />
            ))}
          </div>
          <p className="mt-2 text-center font-mono text-[10px] text-ink-light">
            Example weekly shape · values not shown
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function LandingSignalCard({
  meta,
  title,
  detail,
  implication,
  severity,
  accent,
  assetLabel,
}: {
  meta: string;
  title: string;
  detail: string;
  implication: string;
  severity: "high" | "medium";
  accent?: "interconnector";
  assetLabel: string;
}) {
  const severityClass =
    severity === "high"
      ? "border-transparent bg-[#8B3A3A] text-white"
      : "border-transparent bg-[#92400E] text-white";
  const accentClass =
    accent === "interconnector"
      ? "border-cyan-700/30 bg-cyan-50/80 text-cyan-950"
      : assetLabel === "CCGT"
        ? "border-amber-700/35 bg-amber-50/80 text-amber-900"
        : "border-ivory-border bg-ivory text-ink-mid";

  return (
    <article className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-4">
      <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
        {meta}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-[3px] border-[0.5px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${accentClass}`}
        >
          {assetLabel}
        </span>
        <span
          className={`rounded-[3px] border-[0.5px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${severityClass}`}
        >
          {severity === "high" ? "HIGH" : "MEDIUM"}
        </span>
      </div>
      <h3 className="mt-3 font-sans text-base font-semibold leading-snug text-ink">
        {title}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-mid">{detail}</p>
      <p className="mt-4 border-t border-ivory-border pt-3 font-serif text-[14px] font-medium leading-relaxed text-ink">
        {implication}
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
      className={`rounded-[4px] border-[0.5px] bg-card px-6 py-7 ${
        emphasis ? "border-gold/55" : "border-ivory-border"
      }`}
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-mid">
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
      <p className="mt-4 text-sm leading-relaxed text-ink-mid">{blurb}</p>
      <Link
        href={href}
        className={`mt-8 inline-flex h-10 w-full items-center justify-center rounded-[4px] text-xs font-semibold tracking-[0.08em] transition-colors duration-200 ${
          emphasis
            ? "bg-gold text-ivory hover:bg-[#7a5f1a]"
            : "border-[0.5px] border-ivory-border bg-ivory text-ink hover:bg-ivory-dark"
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

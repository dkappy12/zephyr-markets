"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import { TopoBackground } from "@/components/ui/TopoBackground";
import { formatInTimeZone } from "date-fns-tz";
import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

const tags = ["GB Power · N2EX", "European Gas · TTF/NBP", "REMIT · Live outages"] as const;

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
    feature: "Morning brief",
    free: "08:00 delayed",
    pro: "06:00 live",
    team: "06:00 live per seat",
  },
  {
    feature: "Markets covered",
    free: "GB Power, NBP",
    pro: "5 markets",
    team: "All markets",
  },
  {
    feature: "Portfolio positions",
    free: "—",
    pro: "30 positions",
    team: "Unlimited",
  },
  {
    feature: "Signal history",
    free: "7 days",
    pro: "6 months",
    team: "24 months",
  },
  {
    feature: "API access",
    free: "—",
    pro: "—",
    team: "Full REST API",
  },
  {
    feature: "Data export",
    free: "—",
    pro: "—",
    team: "✓",
  },
  {
    feature: "Team management",
    free: "—",
    pro: "—",
    team: "Admin + invitations",
  },
  {
    feature: "Support",
    free: "Community",
    pro: "Email",
    team: "Priority email",
  },
];

export default function Home() {
  const [tickerItems, setTickerItems] = useState<string[] | null>(null);
  const [brief, setBrief] = useState<{
    text: string;
    generatedAt: string | null;
  } | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    async function loadLandingData() {
      const [physRes, powerRes, gasRes, signalRes, briefRes] = await Promise.all([
        supabase
          .from("physical_premium")
          .select("normalised_score,direction")
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("market_prices")
          .select("price_gbp_mwh")
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
          .from("signals")
          .select("*", { count: "exact", head: true })
          .gte("created_at", since),
        supabase
          .from("brief_entries")
          .select("executive_summary,overnight_summary,generated_at,created_at")
          .order("generated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (briefRes.data && !briefRes.error) {
        const executive = briefRes.data.executive_summary;
        const overnight = briefRes.data.overnight_summary;
        setBrief({
          text:
            (typeof executive === "string" && executive.trim() !== ""
              ? executive
              : typeof overnight === "string"
                ? overnight
                : "") ?? "",
          generatedAt:
            typeof briefRes.data.generated_at === "string"
              ? briefRes.data.generated_at
              : typeof briefRes.data.created_at === "string"
                ? briefRes.data.created_at
                : null,
        });
      } else {
        setBrief(null);
      }

      if (physRes.error || powerRes.error || gasRes.error || signalRes.error) {
        setTickerItems(null);
        return;
      }

      const score = Number(physRes.data?.normalised_score);
      const dir = String(physRes.data?.direction ?? "STABLE").toUpperCase();
      const power = Number(powerRes.data?.price_gbp_mwh);
      const ttf = Number(gasRes.data?.price_eur_mwh);
      const signalCount = signalRes.count ?? 0;
      if (!Number.isFinite(score) || !Number.isFinite(power) || !Number.isFinite(ttf)) {
        setTickerItems(null);
        return;
      }

      setTickerItems([
        `Physical premium · ${score >= 0 ? "+" : ""}${score.toFixed(1)} ${dir}`,
        `GB day-ahead · £${power.toFixed(2)}/MWh`,
        `TTF · €${ttf.toFixed(2)}/MWh`,
        `Signals 24h · ${signalCount}`,
      ]);
    }

    void loadLandingData();
  }, []);

  const briefTimeLabel = useMemo(() => {
    if (!brief?.generatedAt) return null;
    try {
      return formatInTimeZone(new Date(brief.generatedAt), "UTC", "EEEE d MMMM · HH:mm 'UTC'");
    } catch {
      return null;
    }
  }, [brief?.generatedAt]);

  return (
    <div className="flex min-h-screen flex-col bg-ivory">
      <section className="relative overflow-hidden border-b-[0.5px] border-ivory-border">
        <div className="pointer-events-none absolute inset-0 z-0 min-h-[420px]">
          <TopoBackground className="h-full w-full min-h-[420px]" lineOpacity={0.25} />
        </div>
        <div className="relative z-10 mx-auto max-w-[1100px] px-4 pb-16 pt-[120px] sm:px-6 sm:pb-24 sm:pt-[128px] lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <motion.h1
              custom={0}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="font-serif text-4xl font-medium leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[3.25rem]"
            >
              Know the physical picture before markets open.
            </motion.h1>
            <motion.p
              custom={1}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-ink-mid sm:text-lg"
            >
              Zephyr is a real-time intelligence platform for GB power and
              European gas traders. Physical premium score, REMIT signal feed,
              and an AI-generated morning brief - updated every 5 minutes.
            </motion.p>
            <motion.div
              custom={2}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
            >
              <Link
                href="/signup"
                className="inline-flex h-11 min-w-[180px] items-center justify-center rounded-[4px] bg-ink px-6 text-sm font-semibold tracking-normal text-ivory transition-colors duration-200 hover:bg-[#1f1d1a]"
              >
                Start free
              </Link>
              <Link
                href="/dashboard/brief"
                className="inline-flex h-11 min-w-[180px] items-center justify-center rounded-[4px] border border-ink bg-transparent px-6 text-sm font-semibold tracking-normal text-ink transition-colors duration-200 hover:bg-ivory-dark/40"
              >
                View today&apos;s brief
              </Link>
            </motion.div>
            <motion.div
              custom={3}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mt-12 flex flex-wrap items-center justify-center gap-2"
            >
              {tags.map((t) => (
                <span
                  key={t}
                  className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-3 py-1.5 font-sans text-[9px] font-medium uppercase tracking-[0.12em] text-ink"
                >
                  {t}
                </span>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {tickerItems && tickerItems.length > 0 ? (
        <div className="border-b-[0.5px] border-ivory-border bg-ink text-ivory">
          <div className="relative overflow-hidden py-2">
            <div className="animate-ticker-marquee flex w-max gap-12 whitespace-nowrap font-sans text-[9px] font-medium uppercase tracking-[0.2em] text-ivory/90">
              {[...tickerItems, ...tickerItems].map((line, i) => (
                <span key={`${line}-${i}`}>{line}</span>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <section className="border-b-[0.5px] border-ivory-border py-16 sm:py-20">
        <div className="mx-auto max-w-[900px] px-4 sm:px-6 lg:px-8">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            This morning&apos;s brief
          </p>
          {brief?.text ? (
            <div className="mt-4 rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-5">
              <blockquote className="border-l-2 border-[#1D6B4E] pl-4 font-serif text-lg leading-relaxed text-ink">
                {brief.text}
              </blockquote>
              <p className="mt-4 text-xs text-ink-light">
                {briefTimeLabel ?? "—"}
              </p>
              <Link
                href="/dashboard/brief"
                className="mt-3 inline-block text-sm font-medium text-ink-mid underline decoration-ivory-border underline-offset-2 transition-colors hover:text-ink"
              >
                Read full brief →
              </Link>
            </div>
          ) : (
            <div className="mt-4 rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-5">
              <p className="italic text-ink-mid">
                The morning brief publishes daily at 06:00 UTC.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="border-b-[0.5px] border-ivory-border py-24 sm:py-32">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x-[0.5px] md:divide-ivory-border">
            <OutcomeColumn
              title="Know what moved overnight"
              body="The morning brief synthesises REMIT outages, gas moves, and wind forecasts into a 200-word trader read. Published at 06:00 UTC before GB markets open."
              className="md:pr-8"
            />
            <OutcomeColumn
              title="See which outages matter to your book"
              body="The signal feed parses every REMIT notice, classifies it by asset type and severity, and tells you the market implication in plain English."
              className="md:px-8"
            />
            <OutcomeColumn
              title="Understand where the market is vs fundamentals"
              body="The physical premium score compares the N2EX day-ahead price against a CCGT-anchored SRMC model updated every 5 minutes. Know when the market is mispriced before you trade."
              className="md:pl-8"
            />
          </div>
        </div>
      </section>

      <section id="pricing" className="py-16 sm:py-20">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="font-serif text-3xl text-ink sm:text-4xl">
              Pricing
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-mid">
              Start on delayed data. Upgrade when you need real time and the
              full market set.
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
              blurb="Live signals, 06:00 brief, five markets, portfolio tools."
              cta="Get Pro"
              href="/signup?plan=pro"
              emphasis
              footnote="Stripe integration coming soon — sign up now to reserve your place."
            />
            <PricingCard
              name="Team"
              price="£149"
              period="/month"
              blurb="Five seats, unlimited positions, API access, all markets."
              cta="Get Team"
              href="/signup?plan=team"
              emphasis={false}
              footnote="Stripe integration coming soon — sign up now to reserve your place."
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
            Compare tiers at a glance. Upgrade when you need real time, depth, or
            a full desk on one book.
          </p>
          <div className="mt-10 overflow-x-auto rounded-[4px] border-[0.5px] border-ivory-border bg-card shadow-sm">
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
        </div>
      </section>

      <footer className="border-t-[0.5px] border-ivory-border py-10">
        <div className="mx-auto max-w-[1100px] px-4 text-center text-xs text-ink-mid sm:px-6 lg:px-8">
          Zephyr Markets © 2026 · contact@zephyr.markets · Privacy · Terms
        </div>
      </footer>
    </div>
  );
}

function OutcomeColumn({
  title,
  body,
  className = "",
}: {
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <h3 className="font-serif text-xl text-ink">{title}</h3>
      <p className="mt-5 text-sm leading-relaxed text-ink-mid">{body}</p>
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
  const isDash = value === "—";
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

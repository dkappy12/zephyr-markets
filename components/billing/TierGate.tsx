"use client";

import { startStripeSubscriptionCheckout } from "@/lib/billing/start-stripe-checkout";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export type TierGateProps = {
  requiredTier: "pro" | "team";
  currentTier: "free" | "pro" | "team" | null;
  featureName: string;
  description: string;
  children: ReactNode;
  /** Static mockup to show blurred behind the gate.
      If not provided, shows a generic blurred placeholder. */
  mockup?: ReactNode;
};

const TIER_RANK: Record<"free" | "pro" | "team", number> = {
  free: 0,
  pro: 1,
  team: 2,
};

function tierMeetsOrExceeds(
  current: "free" | "pro" | "team",
  required: "pro" | "team",
): boolean {
  return TIER_RANK[current] >= TIER_RANK[required];
}

export function TierGate({
  requiredTier,
  currentTier,
  featureName,
  description,
  children,
  mockup,
}: TierGateProps) {
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  async function handleGetPaidPlan() {
    setCheckoutLoading(true);
    try {
      await startStripeSubscriptionCheckout({
        tier: requiredTier,
        interval: "monthly",
      });
    } catch {
      setCheckoutLoading(false);
    }
  }

  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) {
        setCheckoutLoading(false);
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Billing tier not yet known — show a neutral placeholder so the page shell
  // does not look broken or "logged out" while /api/billing/status resolves.
  if (currentTier === null) {
    return (
      <div
        className="relative min-h-[320px]"
        aria-busy="true"
        aria-label="Loading subscription status"
      >
        <div className="pointer-events-none select-none opacity-[0.38]">
          {mockup ?? <GenericMockup />}
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-10">
          <p className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory/90 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid shadow-sm">
            Loading plan…
          </p>
        </div>
      </div>
    );
  }

  // Has access — render normally
  if (tierMeetsOrExceeds(currentTier, requiredTier)) {
    return <>{children}</>;
  }

  // Gated — show static mockup blurred with overlay panel
  return (
    <div className="relative min-h-[600px]">
      {/* Static blurred mockup behind */}
      <div className="pointer-events-none select-none blur-[3px] opacity-75">
        {mockup ?? <GenericMockup />}
      </div>

      {/* Gate panel — within page flow so dashboard nav stays clickable */}
      <div className="absolute inset-0 z-40 flex items-center justify-center pt-16">
        <div className="mx-auto max-w-sm rounded-[6px] border-[0.5px] border-ivory-border bg-ivory/98 px-8 py-10 text-center shadow-xl backdrop-blur-sm">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-ink/5">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-ink-mid"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          <p className="font-serif text-2xl text-ink">{featureName}</p>

          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
            {requiredTier === "pro" ? "Pro plan" : "Team plan"} required
          </p>

          <p className="mt-3 text-sm leading-relaxed text-ink-mid">{description}</p>

          <button
            type="button"
            disabled={checkoutLoading}
            onClick={() => void handleGetPaidPlan()}
            className="mt-6 inline-flex items-center rounded-[4px] bg-ink px-6 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ivory transition-colors hover:bg-[#1f1d1a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {checkoutLoading
              ? "Redirecting…"
              : `${requiredTier === "pro" ? "Get Pro" : "Get Team"} →`}
          </button>

          <p className="mt-3 text-xs text-ink-light">
            Already subscribed?{" "}
            <Link href="/dashboard/settings?tab=plan" className="underline hover:text-ink">
              Check your plan
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function GenericMockup() {
  return (
    <div className="space-y-4 p-6">
      <div className="h-8 w-48 rounded bg-ink/10" />
      <div className="h-4 w-72 rounded bg-ink/8" />
      <div className="mt-6 grid grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-[4px] border border-ivory-border bg-card" />
        ))}
      </div>
      <div className="h-48 rounded-[4px] border border-ivory-border bg-card" />
      <div className="h-32 rounded-[4px] border border-ivory-border bg-card" />
    </div>
  );
}

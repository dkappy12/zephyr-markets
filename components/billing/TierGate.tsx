"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type TierGateProps = {
  requiredTier: "pro" | "team";
  currentTier: "free" | "pro" | "team" | null;
  featureName: string;
  description: string;
  children: ReactNode;
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
}: TierGateProps) {
  if (currentTier === null || tierMeetsOrExceeds(currentTier, requiredTier)) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-sm opacity-60">{children}</div>

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="mx-auto max-w-sm rounded-[6px] border-[0.5px] border-ivory-border bg-ivory/95 px-8 py-10 text-center shadow-lg backdrop-blur-sm">
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

          <Link
            href="/dashboard/settings?tab=plan"
            className="mt-6 inline-flex items-center rounded-[4px] bg-ink px-6 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ivory transition-colors hover:bg-[#1f1d1a]"
          >
            {requiredTier === "pro" ? "Get Pro" : "Get Team"} →
          </Link>

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

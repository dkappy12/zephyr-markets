"use client";

import { TierGate } from "@/components/billing/TierGate";
import { BookPageClient } from "@/components/portfolio/BookPageClient";
import { useEffect, useState } from "react";

export default function BookPage() {
  const [currentTier, setCurrentTier] = useState<"free" | "pro" | "team" | null>(null);

  useEffect(() => {
    fetch("/api/billing/status")
      .then((r) => r.json())
      .then((body: { effectiveTier?: string }) => {
        const t = body.effectiveTier;
        setCurrentTier(t === "pro" || t === "team" ? t : "free");
      })
      .catch(() => setCurrentTier("free"));
  }, []);

  return (
    <TierGate
      requiredTier="pro"
      currentTier={currentTier}
      featureName="Portfolio Book"
      description="Track positions, P&L attribution, and trade history. Available on the Pro plan."
      mockup={
        <div className="space-y-4 p-6">
          <div className="h-9 w-24 rounded bg-ink/10" />
          <div className="h-4 w-64 rounded bg-ink/8" />
          <div className="rounded-[4px] border border-ivory-border bg-card p-4">
            <div className="grid grid-cols-4 gap-4">
              {["TOTAL POSITIONS", "OPEN P&L", "DAY CHANGE", "NET DELTA"].map((l) => (
                <div key={l}>
                  <div className="mb-2 h-3 w-20 rounded bg-ink/10" />
                  <div className="h-7 w-16 rounded bg-ink/15" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[4px] border border-ivory-border bg-card">
            <div className="grid grid-cols-6 gap-2 border-b border-ivory-border p-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-3 w-full rounded bg-ink/10" />
              ))}
            </div>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="grid grid-cols-6 gap-2 border-b border-ivory-border p-3">
                {[...Array(6)].map((_, j) => (
                  <div key={j} className="h-3 w-full rounded bg-ink/8" />
                ))}
              </div>
            ))}
          </div>
        </div>
      }
    >
      <BookPageClient />
    </TierGate>
  );
}

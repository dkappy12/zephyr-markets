"use client";

import { TierGate } from "@/components/billing/TierGate";
import { AttributionPageClient } from "@/components/portfolio/AttributionPageClient";
import { useEffect, useState } from "react";

export default function AttributionPage() {
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
      featureName="P&L Attribution"
      description="Understand what's driving your book P&L across gas, power, carbon, and FX factors. Available on the Pro plan."
      mockup={
        <div className="space-y-4 p-6">
          <div className="h-9 w-40 rounded bg-ink/10" />
          <div className="h-4 w-56 rounded bg-ink/8" />
          <div className="grid grid-cols-4 gap-3">
            {["GB POWER", "GAS", "CARBON", "FX"].map((l) => (
              <div key={l} className="rounded-[4px] border border-ivory-border bg-card p-4">
                <div className="mb-3 h-3 w-16 rounded bg-ink/10" />
                <div className="mb-1 h-6 w-20 rounded bg-ink/15" />
                <div className="h-3 w-12 rounded bg-ink/8" />
              </div>
            ))}
          </div>
          <div className="h-48 rounded-[4px] border border-ivory-border bg-card p-4" />
          <div className="h-32 rounded-[4px] border border-ivory-border bg-card p-4" />
        </div>
      }
    >
      <AttributionPageClient />
    </TierGate>
  );
}

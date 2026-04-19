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
    >
      <AttributionPageClient />
    </TierGate>
  );
}

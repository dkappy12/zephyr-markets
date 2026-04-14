export type ReliabilityConfidence = "high" | "medium" | "low";

export type ReliabilityEnvelope = {
  model_version: string;
  data_version: string;
  fallback_used: boolean;
  coverage: number;
  confidence: ReliabilityConfidence;
  evidence: string[];
  freshness_ts: string;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function makeReliabilityEnvelope(input: {
  modelVersion: string;
  dataVersion: string;
  fallbackUsed: boolean;
  coverage: number;
  confidence?: ReliabilityConfidence;
  evidence?: string[];
  freshnessTs?: string;
}): ReliabilityEnvelope {
  const confidence =
    input.confidence ??
    (input.fallbackUsed || input.coverage < 0.5
      ? "low"
      : input.coverage < 0.8
        ? "medium"
        : "high");
  return {
    model_version: input.modelVersion,
    data_version: input.dataVersion,
    fallback_used: input.fallbackUsed,
    coverage: clamp01(input.coverage),
    confidence,
    evidence: input.evidence ?? [],
    freshness_ts: input.freshnessTs ?? new Date().toISOString(),
  };
}


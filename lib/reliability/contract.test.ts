import { describe, expect, it } from "vitest";
import {
  formatReliabilityConfidenceDesk,
  isReliabilityEnvelope,
  makeReliabilityEnvelope,
  reliabilityConfidenceFromBriefAgeHours,
  reliabilityConfidenceFromRemitStalenessMinutes,
  reliabilityConfidenceFromVaRHistoryDays,
} from "./contract";

describe("makeReliabilityEnvelope", () => {
  it("returns all contract fields", () => {
    const r = makeReliabilityEnvelope({
      modelVersion: "m1",
      dataVersion: "d1",
      fallbackUsed: false,
      coverage: 0.9,
      evidence: ["ok"],
      freshnessTs: "2026-01-01T00:00:00.000Z",
    });
    expect(isReliabilityEnvelope(r)).toBe(true);
    expect(r.model_version).toBe("m1");
    expect(r.data_version).toBe("d1");
    expect(r.fallback_used).toBe(false);
    expect(r.coverage).toBe(0.9);
    expect(r.confidence).toBe("high");
    expect(r.evidence).toEqual(["ok"]);
    expect(r.freshness_ts).toBe("2026-01-01T00:00:00.000Z");
  });

  it("derives low confidence when fallback used", () => {
    const r = makeReliabilityEnvelope({
      modelVersion: "m",
      dataVersion: "d",
      fallbackUsed: true,
      coverage: 1,
    });
    expect(r.confidence).toBe("low");
  });
});

describe("isReliabilityEnvelope", () => {
  it("rejects partial objects", () => {
    expect(isReliabilityEnvelope(null)).toBe(false);
    expect(isReliabilityEnvelope({ model_version: "x" })).toBe(false);
  });
});

describe("desk reliability bands", () => {
  it("brief age hours", () => {
    expect(formatReliabilityConfidenceDesk(reliabilityConfidenceFromBriefAgeHours(null))).toBe(
      "LOW",
    );
    expect(formatReliabilityConfidenceDesk(reliabilityConfidenceFromBriefAgeHours(10))).toBe(
      "HIGH",
    );
    expect(formatReliabilityConfidenceDesk(reliabilityConfidenceFromBriefAgeHours(36))).toBe(
      "MEDIUM",
    );
    expect(formatReliabilityConfidenceDesk(reliabilityConfidenceFromBriefAgeHours(72))).toBe(
      "LOW",
    );
  });

  it("VaR history days", () => {
    expect(formatReliabilityConfidenceDesk(reliabilityConfidenceFromVaRHistoryDays(25))).toBe(
      "HIGH",
    );
    expect(formatReliabilityConfidenceDesk(reliabilityConfidenceFromVaRHistoryDays(15))).toBe(
      "MEDIUM",
    );
    expect(formatReliabilityConfidenceDesk(reliabilityConfidenceFromVaRHistoryDays(5))).toBe(
      "LOW",
    );
  });

  it("REMIT staleness minutes", () => {
    expect(
      formatReliabilityConfidenceDesk(reliabilityConfidenceFromRemitStalenessMinutes(null)),
    ).toBe("LOW");
    expect(
      formatReliabilityConfidenceDesk(reliabilityConfidenceFromRemitStalenessMinutes(10)),
    ).toBe("HIGH");
    expect(
      formatReliabilityConfidenceDesk(reliabilityConfidenceFromRemitStalenessMinutes(60)),
    ).toBe("MEDIUM");
    expect(
      formatReliabilityConfidenceDesk(reliabilityConfidenceFromRemitStalenessMinutes(200)),
    ).toBe("LOW");
  });
});

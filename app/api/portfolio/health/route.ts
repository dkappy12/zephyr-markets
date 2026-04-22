import { NextResponse } from "next/server";
import { netGbPowerSignedMw } from "@/lib/portfolio/attribution";
import { type PositionRow, positionDirectionSign } from "@/lib/portfolio/book";
import { calculateScenarioStressImpact } from "@/lib/portfolio/risk-stress-scenario-impact";

type CheckResult = {
  name: string;
  ok: boolean;
  details?: string;
};

function fixturePosition(overrides: Partial<PositionRow>): PositionRow {
  return {
    id: overrides.id ?? "fixture",
    user_id: overrides.user_id ?? "fixture-user",
    created_at: overrides.created_at ?? "2026-01-01T00:00:00.000Z",
    direction: overrides.direction ?? "long",
    expiry_date: overrides.expiry_date ?? null,
    instrument: overrides.instrument ?? "Fixture",
    instrument_type: overrides.instrument_type ?? "power_forward",
    is_hypothetical: overrides.is_hypothetical ?? true,
    market: overrides.market ?? "GB_power",
    size: overrides.size ?? 1,
    tenor: overrides.tenor ?? "prompt",
    trade_price: overrides.trade_price ?? 100,
    unit: overrides.unit ?? "MW",
    currency: overrides.currency ?? "GBP",
    source: overrides.source ?? "system",
    notes: overrides.notes ?? null,
    is_closed: overrides.is_closed ?? false,
    close_price: overrides.close_price ?? null,
    close_date: overrides.close_date ?? null,
    entry_date: overrides.entry_date ?? "2026-01-01",
    raw_csv_row: overrides.raw_csv_row ?? null,
  };
}

function runPortfolioRegressionChecks(): CheckResult[] {
  const checks: CheckResult[] = [];

  const directionCheck =
    positionDirectionSign("long") === 1 &&
    positionDirectionSign("short") === -1 &&
    positionDirectionSign("unexpected") === 0;
  checks.push({
    name: "direction-normalisation",
    ok: directionCheck,
    details: directionCheck
      ? "long/short/invalid mapping is stable"
      : "direction parser returned an unexpected sign",
  });

  const mixed = netGbPowerSignedMw([
    fixturePosition({ id: "a", direction: "long", size: 10 }),
    fixturePosition({ id: "b", direction: "short", size: 8 }),
  ]);
  const mixedCheck = mixed.isMixed === true;
  checks.push({
    name: "mixed-gb-detection",
    ok: mixedCheck,
    details: mixedCheck
      ? "long+short GB book marks mixed=true"
      : `expected mixed=true, got ${String(mixed.isMixed)}`,
  });

  const stress = calculateScenarioStressImpact(
    {
      GB_power: 10,
      TTF: 0,
      NBP: 0,
      UKA: 0,
      EUA: 0,
    },
    [fixturePosition({ direction: "long", size: 2, market: "GB_power" })],
    0.86,
  );
  const stressCheck = Math.abs(stress.total - 20) < 1e-9;
  checks.push({
    name: "stress-impact-smoke",
    ok: stressCheck,
    details: stressCheck
      ? "simple GB stress scenario produces deterministic impact"
      : `expected total=20, got ${stress.total}`,
  });

  return checks;
}

export async function GET() {
  const checks = runPortfolioRegressionChecks();
  const failing = checks.filter((c) => !c.ok);
  return NextResponse.json(
    {
      ok: failing.length === 0,
      checkedAt: new Date().toISOString(),
      scope: "portfolio-regression-smoke",
      checks,
    },
    { status: failing.length === 0 ? 200 : 500 },
  );
}


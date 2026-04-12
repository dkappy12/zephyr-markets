import { NextResponse } from "next/server";

/** BMRS FUELINST — instant generation by fuel type; includes interconnector pseudo-fuel types. */
const FUELINST_URL =
  "https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELINST";

/** Reference capacities (MW) for bar width — not live operational limits. */
export const IC_CAPACITY_MW_REF = {
  IFA_FR: 3000,
  BRITNED: 1000,
  NSL: 1400,
  NEMO: 1000,
  ELECLINK: 1000,
} as const;

type FuelRow = {
  dataset?: string;
  fuelType?: string;
  generation?: number;
  settlementDate?: string;
  settlementPeriod?: number;
  publishTime?: string;
};

function latestSettlementSlice(rows: FuelRow[]): FuelRow[] {
  if (rows.length === 0) return [];
  let best = rows[0];
  for (const r of rows) {
    const ds = String(r.settlementDate ?? "");
    const bd = String(best.settlementDate ?? "");
    if (ds > bd) best = r;
    else if (ds === bd && (r.settlementPeriod ?? 0) > (best.settlementPeriod ?? 0)) {
      best = r;
    }
  }
  const sd = best.settlementDate;
  const sp = best.settlementPeriod;
  return rows.filter(
    (r) => r.settlementDate === sd && r.settlementPeriod === sp,
  );
}

/** Positive generation = import to GB; negative = export from GB (BMRS FUELINST convention). */
export async function GET() {
  try {
    const res = await fetch(FUELINST_URL, {
      next: { revalidate: 120 },
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    let parsed: { data?: FuelRow[] };
    try {
      parsed = JSON.parse(text) as { data?: FuelRow[] };
    } catch {
      return NextResponse.json(
        {
          ok: false,
          status: res.status,
          source: "FUELINST",
          error: "JSON parse failed",
          raw: text.slice(0, 4000),
        },
        { status: 502 },
      );
    }

    const slice = latestSettlementSlice(parsed.data ?? []);
    const byFuel = new Map<string, number>();
    for (const r of slice) {
      const ft = String(r.fuelType ?? "");
      const gen = Number(r.generation);
      if (!Number.isFinite(gen)) continue;
      byFuel.set(ft, gen);
    }
    const gv = (k: string) => byFuel.get(k) ?? 0;

    const rows = [
      {
        id: "ifa_fr",
        label: "IFA",
        country: "France",
        flowMw: gv("INTFR") + gv("INTIFA2"),
        capacityMw: IC_CAPACITY_MW_REF.IFA_FR,
      },
      {
        id: "britned",
        label: "BritNed",
        country: "Netherlands",
        flowMw: gv("INTNED"),
        capacityMw: IC_CAPACITY_MW_REF.BRITNED,
      },
      {
        id: "nsl",
        label: "NSL",
        country: "Norway",
        flowMw: gv("INTNSL"),
        capacityMw: IC_CAPACITY_MW_REF.NSL,
      },
      {
        id: "nemo",
        label: "NEMO",
        country: "Belgium",
        flowMw: gv("INTNEM"),
        capacityMw: IC_CAPACITY_MW_REF.NEMO,
      },
      {
        id: "eleclink",
        label: "ElecLink",
        country: "France",
        flowMw: gv("INTELEC"),
        capacityMw: IC_CAPACITY_MW_REF.ELECLINK,
      },
    ];

    const meta = slice[0];
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      source: "FUELINST",
      settlementDate: meta?.settlementDate ?? null,
      settlementPeriod: meta?.settlementPeriod ?? null,
      publishTime: meta?.publishTime ?? null,
      rows,
      rawRowCount: parsed.data?.length ?? 0,
      rawSample: (parsed.data ?? []).slice(0, 8),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api/require-api-key";
import { createAdminClient } from "@/lib/supabase/admin";
import { GBP_PER_EUR, ttfToNbpPencePerTherm } from "@/lib/portfolio/book";

function parseTimeMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value !== "") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** YYYY-MM-DD → comparable instant (noon UTC). */
function dateStringToMs(ymd: string): number {
  return Date.parse(`${ymd}T12:00:00.000Z`);
}

function rowAsOfMs(row: Record<string, unknown> | null | undefined): number | null {
  if (!row) return null;
  const t =
    parseTimeMs(row.price_time) ??
    parseTimeMs(row.fetched_at);
  if (t != null) return t;
  const pd = row.price_date;
  if (typeof pd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pd)) {
    return dateStringToMs(pd);
  }
  const rd = row.rate_date;
  if (typeof rd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rd)) {
    return dateStringToMs(rd);
  }
  return null;
}

function earliestIso(timestamps: number[]): string {
  if (timestamps.length === 0) return new Date().toISOString();
  return new Date(Math.min(...timestamps)).toISOString();
}

export async function GET(request: Request) {
  try {
    const auth = await requireApiKey(request);
    if (auth.response) return auth.response;

    const admin = createAdminClient();
    const [
      n2exRes,
      ttfRes,
      nbpRes,
      ukaRes,
      euaRes,
      fxRes,
    ] = await Promise.all([
      admin
        .from("market_prices")
        .select("price_gbp_mwh, price_time, fetched_at, price_date")
        .eq("market", "N2EX")
        .order("price_time", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("gas_prices")
        .select("price_eur_mwh, price_time, fetched_at")
        .eq("hub", "TTF")
        .order("price_time", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("gas_prices")
        .select("price_eur_mwh, price_time, fetched_at")
        .eq("hub", "NBP")
        .order("price_time", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("carbon_prices")
        .select("price_gbp_per_t, price_eur_per_t, price_date, fetched_at")
        .eq("hub", "UKA")
        .order("price_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("carbon_prices")
        .select("price_eur_per_t, price_gbp_per_t, price_date, fetched_at")
        .eq("hub", "EUA")
        .order("price_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("fx_rates")
        .select("rate, rate_date")
        .eq("base", "EUR")
        .eq("quote", "GBP")
        .order("rate_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const errors = [
      n2exRes.error,
      ttfRes.error,
      nbpRes.error,
      ukaRes.error,
      euaRes.error,
      fxRes.error,
    ].filter(Boolean);
    if (errors.length > 0) {
      throw new Error(errors[0]!.message);
    }

    const n2ex = n2exRes.data as Record<string, unknown> | null;
    const ttf = ttfRes.data as Record<string, unknown> | null;
    const nbp = nbpRes.data as Record<string, unknown> | null;
    const uka = ukaRes.data as Record<string, unknown> | null;
    const eua = euaRes.data as Record<string, unknown> | null;
    const fx = fxRes.data as Record<string, unknown> | null;

    const gbpPerEurRaw = fx?.rate != null ? Number(fx.rate) : NaN;
    const gbpPerEur = Number.isFinite(gbpPerEurRaw) ? gbpPerEurRaw : GBP_PER_EUR;

    const n2exGbp = n2ex?.price_gbp_mwh != null ? Number(n2ex.price_gbp_mwh) : NaN;
    const ttfEur = ttf?.price_eur_mwh != null ? Number(ttf.price_eur_mwh) : NaN;
    const nbpEur = nbp?.price_eur_mwh != null ? Number(nbp.price_eur_mwh) : NaN;

    const nbpPenceTherm =
      Number.isFinite(nbpEur) && nbpEur > 0
        ? ttfToNbpPencePerTherm(nbpEur, gbpPerEur)
        : null;

    const ukaGbp =
      uka?.price_gbp_per_t != null ? Number(uka.price_gbp_per_t) : NaN;
    const euaEur =
      eua?.price_eur_per_t != null ? Number(eua.price_eur_per_t) : NaN;

    const asOfTimes: number[] = [];
    for (const ms of [
      rowAsOfMs(n2ex ?? undefined),
      rowAsOfMs(ttf ?? undefined),
      rowAsOfMs(nbp ?? undefined),
      rowAsOfMs(uka ?? undefined),
      rowAsOfMs(eua ?? undefined),
      fx ? rowAsOfMs(fx) : null,
    ]) {
      if (ms != null) asOfTimes.push(ms);
    }

    return NextResponse.json({
      data: {
        n2ex_gbp_mwh: Number.isFinite(n2exGbp) ? n2exGbp : null,
        ttf_eur_mwh: Number.isFinite(ttfEur) ? ttfEur : null,
        nbp_pence_therm: nbpPenceTherm,
        uka_gbp_t: Number.isFinite(ukaGbp) ? ukaGbp : null,
        eua_eur_t: Number.isFinite(euaEur) ? euaEur : null,
        gbp_eur: gbpPerEur,
        as_of: earliestIso(asOfTimes),
      },
      meta: {
        generated_at: new Date().toISOString(),
        endpoint: "/api/v1/markets",
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load markets data" },
      { status: 500 },
    );
  }
}
